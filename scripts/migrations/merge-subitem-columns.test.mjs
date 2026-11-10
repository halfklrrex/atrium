// Tests for the subitem-columns merge migration (SUBITEMS-as-items): the dry run writes nothing,
// --apply merges / moves / drops, writes field paths only, reads subitems in every state, skips a
// board with a type change running, and a rerun is a no-op. Run through tsx.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import {
  CHUNK_SIZE,
  boardOwnerUid,
  parseCliArgs,
  resolveOptions,
  runMigration,
} from './2026-11-merge-subitem-columns.mjs';

const quiet = () => {};
const col = (id, type, title, extra = {}) => ({
  id,
  type,
  title,
  position: 'a0',
  settings: {},
  ...extra,
});
const statusCol = (id, title, labels) => ({
  id,
  type: 'status',
  title,
  position: 'a0',
  settings: {
    labels: labels.map(([index, label]) => ({ id: `l${index}`, index, label, color: '#111111' })),
  },
});

/** In-memory Firestore with the client surface the migration uses. */
function fakeClient(docs) {
  const store = new Map(Object.entries(structuredClone(docs)));
  const commits = [];
  const get = (path) => store.get(path);
  return {
    describe: 'fake',
    store,
    commits,
    async listAllDocs(collection, { fields } = {}) {
      const prefix = `${collection}/`;
      return [...store]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({
          id: path.slice(prefix.length),
          data: Object.fromEntries(
            Object.entries(structuredClone(data)).filter(([k]) => !fields || fields.includes(k)),
          ),
          updateTime: 't1',
        }));
    },
    async getDoc(path) {
      const doc = get(path);
      return doc ? structuredClone(doc) : null;
    },
    async commit(writes) {
      assert.ok(writes.length <= 500);
      commits.push(writes);
      for (const w of writes) {
        assert.equal(w.op, 'update', 'field-path updates only: never a set or a whole-map patch');
        const doc = get(w.path);
        assert.ok(doc, 'never creates a document');
        for (const [path, value] of Object.entries(w.set ?? {})) {
          const [head, ...rest] = path.split('.');
          if (rest.length === 0) doc[head] = structuredClone(value);
          else {
            assert.equal(head, 'values', 'item writes only touch values.<id>');
            doc.values[rest.join('.')] = structuredClone(value);
          }
        }
        for (const path of w.remove ?? []) {
          assert.ok(path.startsWith('values.'));
          delete doc.values[path.slice('values.'.length)];
        }
        if (w.serverTimestamp?.includes('updatedAt')) doc.updatedAt = 'now';
      }
    },
  };
}

const sub = (parent, values, state = 'active') => ({
  name: 'sub',
  parentItemId: parent,
  state,
  values,
});

function world(overrides = {}) {
  return {
    'boards/b1': {
      access: { u1: 'owner', u2: 'editor' },
      workspaceId: 'w1',
      columns: [
        statusCol('status', 'Status', [
          [0, 'Working'],
          [1, 'Done'],
        ]),
        col('person', 'people', 'Person'),
      ],
      subitemColumns: [
        col('sub_owner', 'people', 'Person'),
        statusCol('sub_status', 'status', [
          [0, 'done'],
          [4, 'Waiting'],
        ]),
        col('sub_date', 'date', 'Date'),
        col('sub_files', 'files', 'Attachments'),
        col('sub_empty', 'text', 'Unused'),
      ],
      columnLocks: ['sub_status', 'sub_empty', 'person'],
      ...overrides,
    },
    'boards/b1/items/p1': {
      name: 'parent',
      parentItemId: null,
      state: 'active',
      values: { person: 'keep' },
    },
    'boards/b1/items/s1': sub('p1', {
      sub_owner: { personsAndTeams: [{ id: 'u1', kind: 'person' }] },
      sub_status: { index: 4 },
      sub_empty: '',
    }),
    'boards/b1/items/s2': sub(
      'p1',
      { sub_status: { index: 0 }, sub_files: [{ name: 'a.txt' }] },
      'archived',
    ),
    'boards/b1/items/s3': sub('p1', { sub_date: { date: '2026-11-01' } }, 'deleted'),
    'boards/b2': { access: { u1: 'owner' }, workspaceId: 'w1', columns: [], subitemColumns: [] },
  };
}

const ids = (writes) => writes.flat().map((w) => w.path);

test('the dry run writes nothing and reports the plan', async () => {
  const client = fakeClient(world());
  const lines = [];
  const result = await runMigration({ client, log: (l) => lines.push(l) });
  assert.equal(client.commits.length, 0);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].subitemCount, 3);
  assert.deepEqual(
    result.plans[0].decisions.map((d) => [d.columnId, d.action]),
    [
      ['sub_owner', 'merge'],
      ['sub_status', 'merge'],
      ['sub_date', 'move'],
      ['sub_files', 'move'],
      ['sub_empty', 'drop'],
    ],
  );
  assert.match(lines.join('\n'), /Nothing was written/);
  assert.match(lines.join('\n'), /adds labels \["Waiting"\]/);
});

test('--apply merges, moves and drops, with subitems of every state', async () => {
  const client = fakeClient(world());
  await runMigration({ client, apply: true, log: quiet });
  const board = client.store.get('boards/b1');
  assert.deepEqual(board.subitemColumns, []);
  assert.equal(board.updatedBy, 'u1');
  assert.equal(board.updatedAt, 'now');
  assert.deepEqual(
    board.columns.map((c) => c.id),
    ['status', 'person', 'sub_date', 'sub_files'],
  );
  assert.ok(board.columns[2].position > board.columns[1].position);
  assert.deepEqual(
    board.columns[0].settings.labels.map((l) => l.label),
    ['Working', 'Done', 'Waiting'],
  );
  // The lock of a merged column moves to its target, a dropped one goes away.
  assert.deepEqual(board.columnLocks.sort(), ['person', 'status']);

  const s1 = client.store.get('boards/b1/items/s1').values;
  assert.deepEqual(s1.person, { personsAndTeams: [{ id: 'u1', kind: 'person' }] });
  assert.deepEqual(s1.status, { index: 2 }, 'the "Waiting" label was appended to the board column');
  assert.equal('sub_owner' in s1, false);
  assert.equal('sub_status' in s1, false);
  assert.equal('sub_empty' in s1, false, 'dropped columns lose their (empty) key');
  // Archived and deleted subitems are migrated too.
  assert.deepEqual(client.store.get('boards/b1/items/s2').values.status, { index: 1 });
  assert.deepEqual(client.store.get('boards/b1/items/s2').values.sub_files, [{ name: 'a.txt' }]);
  assert.deepEqual(client.store.get('boards/b1/items/s3').values.sub_date, { date: '2026-11-01' });
  // The parent is untouched, and no item write touched the audit fields.
  assert.deepEqual(client.store.get('boards/b1/items/p1').values, { person: 'keep' });
  assert.equal(client.store.get('boards/b1/items/s1').updatedAt, undefined);
  assert.equal(client.store.has('boards/b2/items/x'), false);
});

test('writes are ordered: board columns, copies, the board drops subitemColumns, removals', async () => {
  const client = fakeClient(world());
  await runMigration({ client, apply: true, log: quiet });
  const order = client.commits.map((c) => {
    const w = c[0];
    if (w.path === 'boards/b1') return w.set.columns ? 'columns' : 'drop';
    return w.set ? 'copy' : 'remove';
  });
  assert.deepEqual(order, ['columns', 'copy', 'drop', 'remove']);
  assert.ok(!ids(client.commits).includes('boards/b2'));
});

test('a rerun is a no-op', async () => {
  const client = fakeClient(world());
  await runMigration({ client, apply: true, log: quiet });
  const before = client.commits.length;
  const again = await runMigration({ client, apply: true, log: quiet });
  assert.deepEqual(again.plans, []);
  assert.equal(client.commits.length, before);
});

test('a board with a type change running is skipped, even with --apply', async () => {
  const world1 = world();
  world1['boards/b1'].subitemColumns[0].migrating = {
    snapshotId: 'x',
    startedAt: 1,
    kind: 'change',
  };
  const client = fakeClient(world1);
  const result = await runMigration({ client, apply: true, log: quiet });
  assert.equal(client.commits.length, 0);
  assert.deepEqual(result.results, [{ boardId: 'b1', status: 'skipped' }]);
  assert.equal(client.store.get('boards/b1').subitemColumns.length, 5);
});

test('a board without an owner is skipped; --board limits the run', async () => {
  const noOwner = fakeClient(world({ access: { u2: 'editor' } }));
  const result = await runMigration({ client: noOwner, apply: true, log: quiet });
  assert.equal(result.results[0].status, 'skipped');
  const other = fakeClient(world());
  const limited = await runMigration({ client: other, boardId: 'b2', log: quiet });
  assert.deepEqual(limited.plans, []);
});

test('a board edited during the migration stops before it drops subitemColumns', async () => {
  const client = fakeClient(world());
  const commit = client.commit.bind(client);
  client.commit = async (writes) => {
    await commit(writes);
    // A person edits the subitem columns right after the first commit.
    if (client.commits.length === 1) client.store.get('boards/b1').subitemColumns.pop();
  };
  const result = await runMigration({ client, apply: true, log: quiet });
  assert.equal(result.results[0].status, 'failed');
  assert.ok(client.store.get('boards/b1').subitemColumns.length > 0, 'still legacy: safe to rerun');
});

test('large boards are written in commits of at most 400', async () => {
  const w = world();
  for (let i = 0; i < 950; i += 1)
    w[`boards/b1/items/m${i}`] = sub('p1', { sub_status: { index: 0 } });
  const client = fakeClient(w);
  await runMigration({ client, apply: true, log: quiet });
  assert.ok(client.commits.every((c) => c.length <= CHUNK_SIZE));
});

test('arguments: emulator by default, production needs --project, writes need --apply', () => {
  assert.deepEqual(resolveOptions(parseCliArgs([])), {
    target: 'emulator',
    project: 'atrium-board',
    database: FIRESTORE_DATABASE_ID,
    board: undefined,
    apply: false,
    quotaProject: undefined,
  });
  const production = resolveOptions(
    parseCliArgs(['--project', 'atrium-board', '--board', 'abc123']),
  );
  assert.equal(production.target, 'production');
  assert.equal(production.apply, false);
  assert.equal(production.board, 'abc123');
  assert.equal(resolveOptions(parseCliArgs(['--apply'])).apply, true);
  assert.throws(() => resolveOptions(parseCliArgs(['--board', 'a/b'])), /board id/);
  assert.equal(boardOwnerUid({ a: 'editor', b: 'owner' }), 'b');
  assert.equal(boardOwnerUid({}), null);
});
