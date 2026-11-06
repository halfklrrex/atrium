// Tests for the dateKeys backfill: the dry-run default, correct keys (date columns, subitem
// columns), never touching updatedAt, idempotency, skipping deleted items, the race with the
// Cloud Function (preconditions) and chunking. Run through tsx.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import {
  CHUNK_SIZE,
  parseCliArgs,
  planItem,
  resolveOptions,
  runBackfill,
} from './2026-11-backfill-item-date-keys.mjs';

const quiet = () => {};
const at = (n) => new Date(1_700_000_000_000 + n * 1000);

/** In-memory Firestore with update times and preconditions, like the REST commit. */
function fakeClient(docs) {
  const store = new Map(Object.entries(docs).map(([path, data]) => [path, structuredClone(data)]));
  const versions = new Map([...store.keys()].map((path) => [path, 1]));
  const commits = [];
  const conflict = () => Object.assign(new Error('precondition failed'), { status: 409 });
  const client = {
    describe: 'fake',
    store,
    commits,
    versions,
    /** Runs once, right before the next commit: simulates a concurrent write. */
    beforeCommit: null,
    async listAllDocs(collection) {
      const prefix = `${collection}/`;
      return [...store]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({
          id: path.slice(prefix.length),
          data: structuredClone(data),
          updateTime: `v${versions.get(path)}`,
        }));
    },
    async getDocMeta(path) {
      if (!store.has(path)) return null;
      return { data: structuredClone(store.get(path)), updateTime: `v${versions.get(path)}` };
    },
    async commit(writes) {
      if (client.beforeCommit) {
        const hook = client.beforeCommit;
        client.beforeCommit = null;
        hook(client);
      }
      for (const w of writes) {
        if (w.precondition?.updateTime !== `v${versions.get(w.path)}`) throw conflict();
      }
      commits.push(writes);
      for (const w of writes) {
        Object.assign(store.get(w.path), w.data);
        versions.set(w.path, versions.get(w.path) + 1);
      }
    },
  };
  return client;
}

const board = {
  columns: [
    { id: 'due', type: 'date' },
    { id: 'start', type: 'date' },
    { id: 'status', type: 'status' },
  ],
  subitemColumns: [{ id: 'sub_due', type: 'date' }],
};

const item = (name, extra = {}) => ({
  name,
  parentItemId: null,
  state: 'active',
  values: {},
  updatedAt: at(5),
  ...extra,
});

const fixture = () => ({
  'boards/b1': structuredClone(board),
  'boards/b2': { columns: [], subitemColumns: [] },
  'boards/b1/items/i1': item('Plan', {
    values: { start: { date: '2026-12-01' }, due: { date: '2026-11-20', time: '09:00:00' } },
  }),
  'boards/b1/items/s1': item('Sub', {
    parentItemId: 'i1',
    values: { due: { date: '2026-01-01' }, sub_due: { date: '2026-11-21' } },
  }),
  'boards/b2/items/j1': item('Café', { values: { due: { date: '2026-11-20' } } }),
  'boards/b1/items/gone': item('Removed', {
    state: 'deleted',
    values: { due: { date: '2026-11-20' } },
  }),
});

test('fills sorted dateKeys from the date columns, subitems use subitemColumns', async () => {
  const client = fakeClient(fixture());
  const result = await runBackfill({ client, apply: true, log: quiet });
  assert.equal(result.written, 3);
  const get = (path) => client.store.get(path);
  assert.deepEqual(get('boards/b1/items/i1').dateKeys, ['due:2026-11-20', 'start:2026-12-01']);
  assert.deepEqual(get('boards/b1/items/s1').dateKeys, ['sub_due:2026-11-21']);
  assert.deepEqual(get('boards/b2/items/j1').dateKeys, [], 'a board without date columns');
});

test('skips deleted items', async () => {
  const client = fakeClient(fixture());
  await runBackfill({ client, apply: true, log: quiet });
  assert.equal(client.store.get('boards/b1/items/gone').dateKeys, undefined);
  assert.equal(planItem(board, item('x', { state: 'deleted' })), null);
});

test('a dry run writes nothing', async () => {
  const client = fakeClient(fixture());
  const result = await runBackfill({ client, log: quiet });
  assert.equal(result.applied, false);
  assert.equal(result.candidates, 3);
  assert.equal(client.commits.length, 0);
  assert.equal(client.store.get('boards/b1/items/i1').dateKeys, undefined);
});

test('writes only dateKeys: never updatedAt, updatedBy or name', async () => {
  const client = fakeClient(fixture());
  await runBackfill({ client, apply: true, log: quiet });
  assert.deepEqual(client.store.get('boards/b1/items/i1').updatedAt, at(5));
  for (const write of client.commits.flat()) {
    assert.equal(write.op, 'patch');
    assert.deepEqual(Object.keys(write.data), ['dateKeys']);
  }
});

test('is idempotent: a second run, and items already right, write nothing', async () => {
  const docs = fixture();
  docs['boards/b2/items/j1'] = item('Café', {
    values: { due: { date: '2026-11-20' } },
    dateKeys: [],
  });
  const client = fakeClient(docs);
  const first = await runBackfill({ client, apply: true, log: quiet });
  assert.equal(first.written, 2, 'j1 already has the right (empty) keys');
  const commits = client.commits.length;
  const again = await runBackfill({ client, apply: true, log: quiet });
  assert.equal(again.written, 0);
  assert.equal(again.candidates, 0);
  assert.equal(client.commits.length, commits);
});

test('fixes stale keys', async () => {
  const docs = fixture();
  docs['boards/b1/items/i1'] = item('Plan', {
    values: { due: { date: '2026-11-22' } },
    dateKeys: ['due:2026-11-20'],
  });
  const client = fakeClient(docs);
  await runBackfill({ client, apply: true, log: quiet });
  assert.deepEqual(client.store.get('boards/b1/items/i1').dateKeys, ['due:2026-11-22']);
});

test('race: an item written mid-run is re-read and planned again', async () => {
  const client = fakeClient(fixture());
  client.beforeCommit = (c) => {
    // The function moved i1 to another date (and indexed it) just before our commit.
    Object.assign(c.store.get('boards/b1/items/i1'), {
      values: { due: { date: '2026-12-24' } },
      dateKeys: ['due:2026-12-24'],
    });
    c.versions.set('boards/b1/items/i1', 9);
  };
  await runBackfill({ client, apply: true, log: quiet });
  assert.deepEqual(client.store.get('boards/b1/items/i1').dateKeys, ['due:2026-12-24']);
  assert.deepEqual(client.store.get('boards/b1/items/s1').dateKeys, ['sub_due:2026-11-21']);
});

test('every write carries an updateTime precondition', async () => {
  const client = fakeClient(fixture());
  await runBackfill({ client, apply: true, log: quiet });
  for (const write of client.commits.flat()) assert.ok(write.precondition?.updateTime);
});

test('large boards are split into commits of at most 400 writes', async () => {
  const docs = { 'boards/b1': structuredClone(board) };
  for (let i = 0; i < 900; i += 1) {
    docs[`boards/b1/items/i${i}`] = item(`Item ${i}`, { values: { due: { date: '2026-11-20' } } });
  }
  const client = fakeClient(docs);
  await runBackfill({ client, apply: true, log: quiet });
  assert.equal(CHUNK_SIZE, 400);
  assert.equal(client.commits.length, 3);
  assert.ok(client.commits.every((c) => c.length <= 400));
});

test('arguments: emulator by default, production needs --project, writes need --apply', () => {
  assert.deepEqual(resolveOptions(parseCliArgs([])), {
    target: 'emulator',
    project: 'atrium-board',
    database: FIRESTORE_DATABASE_ID,
    apply: false,
    quotaProject: undefined,
  });
  const production = resolveOptions(parseCliArgs(['--project', 'atrium-board']));
  assert.equal(production.target, 'production');
  assert.equal(production.apply, false);
  assert.equal(resolveOptions(parseCliArgs(['--apply'])).apply, true);
  assert.throws(() => resolveOptions(parseCliArgs(['--project', 'Not Valid'])), /valid Firebase/);
});
