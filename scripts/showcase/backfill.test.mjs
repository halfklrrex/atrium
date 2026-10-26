// Tests of the updatesCount backfill: the diff logic and a dry run / write against a fake client.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffCounts, runBackfill } from '../backfill-updates-count.mjs';

test('diffCounts only lists items whose stored count is wrong', () => {
  const items = [
    { id: 'ok', data: { updatesCount: 2 } },
    { id: 'unset-with-updates', data: {} },
    { id: 'unset-no-updates', data: {} },
    { id: 'stale', data: { updatesCount: 5 } },
    { id: 'zero-wrong', data: { updatesCount: 0 } },
  ];
  const counts = new Map([
    ['ok', 2],
    ['unset-with-updates', 3],
    ['stale', 1],
    ['zero-wrong', 4],
  ]);
  assert.deepEqual(diffCounts(items, counts), [
    { id: 'unset-with-updates', from: null, to: 3 },
    { id: 'stale', from: 5, to: 1 },
    { id: 'zero-wrong', from: 0, to: 4 },
  ]);
});

function fakeClient(store) {
  const commits = [];
  const children = (prefix) => [
    ...new Set(
      [...store.keys()]
        .filter((p) => p.startsWith(`${prefix}/`))
        .map((p) => p.slice(prefix.length + 1).split('/')[0]),
    ),
  ];
  return {
    commits,
    describe: 'fake',
    listDocIds: async (c) => children(c),
    listAllDocs: async (c) =>
      children(c).flatMap((id) =>
        store.has(`${c}/${id}`) ? [{ id, data: store.get(`${c}/${id}`) }] : [],
      ),
    commit: async (writes) => {
      commits.push(writes);
      for (const w of writes) store.set(w.path, { ...store.get(w.path), ...w.data });
    },
  };
}

const world = () =>
  new Map([
    ['boards/b1/items/i1', { name: 'a' }],
    ['boards/b1/items/i1/updates/u1', {}],
    ['boards/b1/items/i1/updates/u2', {}],
    ['boards/b1/items/i2', { name: 'b', updatesCount: 0 }],
    ['boards/b2/items/i3', { name: 'c', updatesCount: 1 }],
    ['boards/b2/items/i3/updates/u1', {}],
  ]);

test('a dry run writes nothing; a real run patches only the differing items', async () => {
  const store = world();
  const client = fakeClient(store);
  const log = () => undefined;
  const dry = await runBackfill({ client, dryRun: true, log });
  assert.equal(dry.changed, 1);
  assert.equal(client.commits.length, 0);

  await runBackfill({ client, dryRun: false, log });
  assert.deepEqual(client.commits, [
    [{ op: 'patch', path: 'boards/b1/items/i1', data: { updatesCount: 2 } }],
  ]);
  assert.equal(store.get('boards/b1/items/i1').updatesCount, 2);

  // Converged: a second run finds nothing to do.
  assert.equal((await runBackfill({ client, dryRun: false, log })).changed, 0);
});

test('--board limits the scan to one board', async () => {
  const client = fakeClient(world());
  const result = await runBackfill({ client, boardId: 'b2', dryRun: true, log: () => undefined });
  assert.deepEqual(result, { boards: 1, items: 1, changed: 0 });
});
