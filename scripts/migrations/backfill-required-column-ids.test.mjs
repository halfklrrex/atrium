// Tests for the requiredColumnIds backfill (REQ-1): the plan, idempotency, the dry-run default and
// that it only ever patches `requiredColumnIds`. Run through tsx.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import {
  parseCliArgs,
  planBackfill,
  resolveOptions,
  runBackfill,
} from './2026-11-backfill-required-column-ids.mjs';

const col = (id, required) => ({
  id,
  type: 'text',
  title: id,
  position: 'a0',
  settings: {},
  ...(required === undefined ? {} : { required }),
});
const quiet = () => {};

/** In-memory `boards` collection with the client surface the script uses. */
function fakeClient(boards) {
  const store = new Map(boards.map((b) => [b.id, structuredClone(b.data)]));
  const commits = [];
  return {
    describe: 'fake',
    commits,
    store,
    async listAllDocs(collection, { fields } = {}) {
      assert.equal(collection, 'boards');
      assert.deepEqual(fields, ['columns', 'subitemColumns', 'requiredColumnIds']);
      return [...store].map(([id, data]) => ({ id, data: structuredClone(data) }));
    },
    async commit(writes) {
      assert.ok(writes.length <= 500);
      commits.push(writes);
      for (const w of writes) {
        assert.equal(w.op, 'patch', 'the migration only ever patches');
        assert.deepEqual(Object.keys(w.data), ['requiredColumnIds'], 'and only this field');
        const id = w.path.replace('boards/', '');
        assert.ok(store.has(id), 'never creates a board');
        Object.assign(store.get(id), w.data);
      }
    },
  };
}

const legacy = { id: 'legacy', data: { columns: [col('t')] } };
const legacyRequired = {
  id: 'legacyRequired',
  data: { columns: [col('r', true), col('t', false)], subitemColumns: [col('s', true)] },
};
const ready = { id: 'ready', data: { columns: [col('t')], requiredColumnIds: [] } };
const readyRequired = {
  id: 'readyRequired',
  data: { columns: [col('b', true), col('a', true)], requiredColumnIds: ['b', 'a'] },
};
const stale = { id: 'stale', data: { columns: [col('r', true)], requiredColumnIds: [] } };
const forged = { id: 'forged', data: { columns: [col('t')], requiredColumnIds: ['t'] } };

test('the plan only lists boards whose list is missing or wrong', () => {
  assert.deepEqual(planBackfill([legacy, legacyRequired, ready, readyRequired, stale, forged]), [
    { id: 'legacy', requiredColumnIds: [], had: undefined },
    { id: 'legacyRequired', requiredColumnIds: ['r', 's'], had: undefined },
    { id: 'stale', requiredColumnIds: ['r'], had: [] },
    { id: 'forged', requiredColumnIds: [], had: ['t'] },
  ]);
  assert.deepEqual(planBackfill([]), []);
});

test('a dry run writes nothing', async () => {
  const client = fakeClient([legacy, stale]);
  const result = await runBackfill({ client, log: quiet });
  assert.equal(result.changes.length, 2);
  assert.equal(result.applied, false);
  assert.equal(client.commits.length, 0);
  assert.equal(client.store.get('legacy').requiredColumnIds, undefined);
});

test('--apply patches only the boards that need it, and a second run finds nothing', async () => {
  const client = fakeClient([legacy, legacyRequired, ready, readyRequired, stale]);
  await runBackfill({ client, apply: true, log: quiet });
  assert.deepEqual(client.store.get('legacy').requiredColumnIds, []);
  assert.deepEqual(client.store.get('legacyRequired').requiredColumnIds, ['r', 's']);
  assert.deepEqual(client.store.get('stale').requiredColumnIds, ['r']);
  assert.deepEqual(client.store.get('readyRequired').requiredColumnIds, ['b', 'a']);
  assert.deepEqual(
    client.commits
      .flat()
      .map((w) => w.path)
      .sort(),
    ['boards/legacy', 'boards/legacyRequired', 'boards/stale'],
  );

  const again = await runBackfill({ client, apply: true, log: quiet });
  assert.deepEqual(again.changes, []);
  assert.equal(client.commits.length, 1, 'the second run wrote nothing');
});

test('large backfills are split into commits of at most 400 writes', async () => {
  const boards = Array.from({ length: 950 }, (_, i) => ({
    id: `b${i}`,
    data: { columns: [] },
  }));
  const client = fakeClient(boards);
  await runBackfill({ client, apply: true, log: quiet });
  assert.deepEqual(
    client.commits.map((c) => c.length),
    [400, 400, 150],
  );
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
  assert.equal(production.quotaProject, 'atrium-board');
  assert.equal(resolveOptions(parseCliArgs(['--apply'])).apply, true);
  assert.throws(() => resolveOptions(parseCliArgs(['--project', 'Not Valid'])), /valid Firebase/);
  assert.equal(resolveOptions(parseCliArgs(['--database', 'other-db'])).database, 'other-db');
  assert.throws(() => resolveOptions(parseCliArgs(['--database', 'No Good'])), /database id/);
});
