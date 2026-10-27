// Tests for the item seq / boardSeq backfill: ordering, separate subitem sequences, continuing from
// existing counters, the dry-run default, idempotency, never touching updatedAt, the race with the
// onItemCreated function (preconditions), and the REST commit preconditions. Run through tsx.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { createFirestoreRest } from '../showcase/firestore-rest.mjs';
import {
  assignNumbers,
  parseCliArgs,
  resolveOptions,
  runBackfill,
  sortCandidates,
} from './2026-10-backfill-item-seq.mjs';

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
    /** Runs once, right before the next commit: simulates the Cloud Function winning a race. */
    beforeCommit: null,
    versions,
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
        const exists = store.has(w.path);
        const pre = w.precondition ?? (w.op === 'patch' ? { exists: true } : undefined);
        if (pre?.exists === true && !exists) throw conflict();
        if (pre?.exists === false && exists) throw conflict();
        if (pre?.updateTime && pre.updateTime !== `v${versions.get(w.path)}`) throw conflict();
      }
      commits.push(writes);
      for (const w of writes) {
        if (w.op === 'patch') Object.assign(store.get(w.path), w.data);
        else store.set(w.path, structuredClone(w.data));
        versions.set(w.path, (versions.get(w.path) ?? 0) + 1);
      }
    },
  };
  return client;
}

const item = (n, extra = {}) => ({
  name: `Item ${n}`,
  parentItemId: null,
  createdAt: at(n),
  updatedAt: at(100 + n),
  ...extra,
});

/** Two boards, interleaved creation times, one subitem, one archived item. */
const fixture = () => ({
  'boards/b1': { name: 'One' },
  'boards/b2': { name: 'Two' },
  'boards/b1/items/i3': item(3),
  'boards/b2/items/j2': item(2),
  'boards/b1/items/i1': item(1),
  'boards/b1/items/s4': item(4, { parentItemId: 'i1' }),
  'boards/b1/items/i5': item(5, { state: 'archived' }),
});

test('numbers items oldest first with separate sequences for items and subitems', async () => {
  const client = fakeClient(fixture());
  const result = await runBackfill({ client, apply: true, log: quiet });
  const get = (path) => client.store.get(path);
  assert.equal(result.numbered, 5);
  assert.deepEqual(
    ['b1/items/i1', 'b2/items/j2', 'b1/items/i3', 'b1/items/s4', 'b1/items/i5'].map((p) => {
      const { seq, boardSeq } = get(`boards/${p}`);
      return [seq, boardSeq];
    }),
    [
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 1], // the subitem has its own sequence
      [5, 3], // archived items are numbered too
    ],
  );
  assert.deepEqual(get('counters/items'), { next: 5 });
  assert.deepEqual(get('boards/b1/counters/items'), { nextItem: 3, nextSubitem: 1 });
  assert.deepEqual(get('boards/b2/counters/items'), { nextItem: 1, nextSubitem: 0 });
});

test('never touches updatedAt, updatedBy or any other field', async () => {
  const client = fakeClient(fixture());
  await runBackfill({ client, apply: true, log: quiet });
  assert.deepEqual(client.store.get('boards/b1/items/i1').updatedAt, at(101));
  for (const write of client.commits.flat().filter((w) => w.path.includes('/items/'))) {
    assert.deepEqual(Object.keys(write.data).sort(), ['boardSeq', 'seq']);
  }
});

test('a dry run writes nothing', async () => {
  const client = fakeClient(fixture());
  const result = await runBackfill({ client, log: quiet });
  assert.equal(result.applied, false);
  assert.equal(result.candidates, 5);
  assert.equal(client.commits.length, 0);
  assert.equal(client.store.get('boards/b1/items/i1').seq, undefined);
  assert.equal(client.store.has('counters/items'), false);
});

test('continues from existing counters and skips numbered items; a second run assigns nothing', async () => {
  const docs = fixture();
  docs['counters/items'] = { next: 40 };
  docs['boards/b1/counters/items'] = { nextItem: 7, nextSubitem: 2 };
  docs['boards/b1/items/i1'] = item(1, { seq: 39, boardSeq: 7 });
  const client = fakeClient(docs);
  await runBackfill({ client, apply: true, log: quiet });
  assert.equal(client.store.get('boards/b1/items/i1').seq, 39, 'numbered items are left alone');
  assert.equal(client.store.get('boards/b2/items/j2').seq, 41);
  assert.equal(client.store.get('boards/b1/items/i3').boardSeq, 8);
  assert.equal(client.store.get('boards/b1/items/s4').boardSeq, 3);
  assert.deepEqual(client.store.get('counters/items'), { next: 44 });

  const commits = client.commits.length;
  const again = await runBackfill({ client, apply: true, log: quiet });
  assert.equal(again.numbered, 0);
  assert.equal(client.commits.length, commits, 'the second run wrote nothing');
});

test('fills only the missing number of a partly numbered item', () => {
  const { assignments, global } = assignNumbers(
    [{ boardId: 'b', id: 'x', isSubitem: false, seq: 5 }],
    9,
    new Map([['b', { nextItem: 2, nextSubitem: 0 }]]),
  );
  assert.deepEqual(assignments, [{ boardId: 'b', id: 'x', boardSeq: 3 }]);
  assert.equal(global, 9);
});

test('sorts by createdAt, then board and item id', () => {
  const sorted = sortCandidates([
    { boardId: 'b', id: 'z', createdAt: at(1) },
    { boardId: 'b', id: 'a', createdAt: at(1) },
    { boardId: 'a', id: 'q', createdAt: at(1) },
    { boardId: 'b', id: 'old', createdAt: at(0) },
    { boardId: 'b', id: 'done', createdAt: at(0), seq: 1, boardSeq: 1 },
  ]).map((c) => `${c.boardId}/${c.id}`);
  assert.deepEqual(sorted, ['b/old', 'a/q', 'b/a', 'b/z']);
});

test('race: when the function numbers items mid-run the commit is refused and replanned', async () => {
  const client = fakeClient(fixture());
  client.beforeCommit = (c) => {
    // onItemCreated numbers i1 (seq 1) and advances both counters just before our commit.
    c.store.get('boards/b1/items/i1').seq = 1;
    c.store.get('boards/b1/items/i1').boardSeq = 1;
    c.versions.set('boards/b1/items/i1', 9);
    c.store.set('counters/items', { next: 1 });
    c.versions.set('counters/items', 1);
    c.store.set('boards/b1/counters/items', { nextItem: 1, nextSubitem: 0 });
    c.versions.set('boards/b1/counters/items', 1);
  };
  await runBackfill({ client, apply: true, log: quiet });
  const seqs = [...client.store]
    .filter(([path]) => path.includes('/items/'))
    .map(([, data]) => data.seq)
    .sort((a, b) => a - b);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5], 'no number is handed out twice');
  const boardSeqs = ['i1', 'i3', 'i5'].map(
    (id) => client.store.get(`boards/b1/items/${id}`).boardSeq,
  );
  assert.deepEqual(boardSeqs, [1, 2, 3]);
  assert.deepEqual(client.store.get('counters/items'), { next: 5 });
});

test('every commit guards the counters and each item with a precondition', async () => {
  const client = fakeClient(fixture());
  await runBackfill({ client, apply: true, log: quiet });
  for (const write of client.commits.flat()) {
    assert.ok(write.precondition, `${write.path} has a precondition`);
  }
  const first = client.commits[0].find((w) => w.path === 'counters/items');
  assert.deepEqual(first.precondition, { exists: false });
});

test('large backfills are split into commits well under 500 writes', async () => {
  const docs = { 'boards/b1': { name: 'Big' } };
  for (let i = 0; i < 400; i += 1) docs[`boards/b1/items/i${i}`] = item(i);
  const client = fakeClient(docs);
  await runBackfill({ client, apply: true, log: quiet });
  assert.ok(client.commits.length >= 3);
  assert.ok(client.commits.every((c) => c.length < 500));
  assert.deepEqual(client.store.get('counters/items'), { next: 400 });
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

test('the REST client sends update-time and "does not exist" preconditions', async () => {
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({});
  };
  const client = createFirestoreRest({
    origin: 'http://127.0.0.1:8080',
    project: 'p',
    getToken: () => 'owner',
    fetch: fakeFetch,
  });
  await client.commit([
    {
      op: 'patch',
      path: 'boards/b/items/i',
      data: { seq: 1 },
      precondition: { updateTime: '2026-10-27T00:00:00.000000Z' },
    },
    { op: 'set', path: 'counters/items', data: { next: 1 }, precondition: { exists: false } },
    { op: 'set', path: 'counters/other', data: { next: 1 } },
  ]);
  const body = JSON.parse(requests[0].init.body);
  assert.deepEqual(body.writes[0].currentDocument, { updateTime: '2026-10-27T00:00:00.000000Z' });
  assert.deepEqual(body.writes[0].updateMask, { fieldPaths: ['seq'] });
  assert.deepEqual(body.writes[1].currentDocument, { exists: false });
  assert.equal(body.writes[2].currentDocument, undefined);
});
