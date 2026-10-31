// Tests for the legacy activity cleanup: dry-run default, only old button_clicked docs without an
// expiry are deleted, idempotency and chunking. Run through tsx.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import {
  CHUNK_SIZE,
  isLegacyActivity,
  parseCliArgs,
  resolveOptions,
  runMigration,
} from './2026-11-delete-legacy-activity.mjs';

const quiet = () => {};

/** In-memory Firestore: list board ids, list a collection, commit deletes. */
function fakeClient(docs) {
  const store = new Map(Object.entries(docs).map(([path, data]) => [path, structuredClone(data)]));
  const commits = [];
  const direct = (collection) => {
    const prefix = `${collection}/`;
    return [...store].filter(
      ([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'),
    );
  };
  return {
    describe: 'fake',
    store,
    commits,
    async listDocIds(collection) {
      return direct(collection).map(([path]) => path.slice(collection.length + 1));
    },
    async listAllDocs(collection) {
      return direct(collection).map(([path, data]) => ({
        id: path.slice(collection.length + 1),
        data: structuredClone(data),
      }));
    },
    async commit(writes) {
      commits.push(writes);
      for (const write of writes) {
        assert.equal(write.op, 'delete');
        store.delete(write.path);
      }
    },
  };
}

const legacy = { kind: 'button_clicked', userId: 'u1', data: { columnLabel: 'Go' } };
const current = { kind: 'button_clicked', actorId: 'u1', expiresAt: new Date(1_800_000_000_000) };
const fixture = () => ({
  'boards/b1': {},
  'boards/b2': {},
  'boards/b1/activity/a1': legacy,
  'boards/b1/activity/a2': current,
  'boards/b1/activity/a3': { kind: 'value_changed', actorId: 'u1' },
  'boards/b2/activity/a4': legacy,
  'boards/b2/items/i1': { name: 'not activity' },
});

test('recognises only old button clicks without an expiry', () => {
  assert.equal(isLegacyActivity(legacy), true);
  assert.equal(isLegacyActivity(current), false);
  assert.equal(isLegacyActivity({ kind: 'value_changed' }), false);
});

test('a dry run deletes nothing', async () => {
  const client = fakeClient(fixture());
  const result = await runMigration({ client, log: quiet });
  assert.deepEqual(result, { scanned: 4, candidates: 2, deleted: 0, applied: false });
  assert.equal(client.commits.length, 0);
});

test('apply deletes the legacy docs and leaves everything else', async () => {
  const client = fakeClient(fixture());
  const result = await runMigration({ client, apply: true, log: quiet });
  assert.equal(result.deleted, 2);
  assert.deepEqual([...client.store.keys()].sort(), [
    'boards/b1',
    'boards/b1/activity/a2',
    'boards/b1/activity/a3',
    'boards/b2',
    'boards/b2/items/i1',
  ]);
});

test('is idempotent: a second run finds nothing', async () => {
  const client = fakeClient(fixture());
  await runMigration({ client, apply: true, log: quiet });
  const again = await runMigration({ client, apply: true, log: quiet });
  assert.equal(again.deleted, 0);
  assert.equal(again.candidates, 0);
});

test('deletes in chunks of at most 400', async () => {
  const docs = { 'boards/b1': {} };
  for (let i = 0; i < CHUNK_SIZE + 5; i += 1) docs[`boards/b1/activity/l${i}`] = legacy;
  const client = fakeClient(docs);
  const result = await runMigration({ client, apply: true, log: quiet });
  assert.equal(result.deleted, CHUNK_SIZE + 5);
  assert.deepEqual(
    client.commits.map((c) => c.length),
    [CHUNK_SIZE, 5],
  );
});

test('options: emulator by default, production only with --project, database default', () => {
  const emulator = resolveOptions(parseCliArgs([]));
  assert.equal(emulator.target, 'emulator');
  assert.equal(emulator.apply, false);
  assert.equal(emulator.database, FIRESTORE_DATABASE_ID);
  const prod = resolveOptions(parseCliArgs(['--project', 'atrium-board', '--apply']));
  assert.equal(prod.target, 'production');
  assert.equal(prod.apply, true);
  assert.throws(() => resolveOptions(parseCliArgs(['--project', 'Bad Id'])));
});
