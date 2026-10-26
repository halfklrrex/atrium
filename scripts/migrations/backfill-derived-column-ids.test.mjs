// Tests for the derivedColumnIds / serverManagedColumnIds backfill: the plan, idempotency, the dry-run default, and the REST
// requests (field mask and "must exist" precondition) against fakes. Run through tsx.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FIRESTORE_DATABASE_ID,
  columnRegistry,
  defineColumnType,
  textColumn,
} from '@atrium/shared';
import { createFirestoreRest } from '../showcase/firestore-rest.mjs';
import {
  parseCliArgs,
  planBackfill,
  resolveOptions,
  runBackfill,
} from './2026-10-backfill-derived-column-ids.mjs';

// No production column type is derived yet, so the shared registry gets a test-only one.
columnRegistry.register(
  defineColumnType({
    ...textColumn,
    type: 'test_derived',
    label: 'Test derived',
    derived: true,
    compute: () => 'x',
  }),
);

const col = (id, type) => ({ id, type, title: id, position: 'a0', settings: {} });
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
      assert.deepEqual(fields, [
        'columns',
        'subitemColumns',
        'derivedColumnIds',
        'serverManagedColumnIds',
      ]);
      return [...store].map(([id, data]) => ({ id, data: structuredClone(data) }));
    },
    async commit(writes) {
      assert.ok(writes.length <= 500);
      commits.push(writes);
      for (const w of writes) {
        assert.equal(w.op, 'patch', 'the migration only ever patches');
        const id = w.path.replace('boards/', '');
        assert.ok(store.has(id), 'never creates a board');
        Object.assign(store.get(id), w.data);
      }
    },
  };
}

const legacy = { id: 'legacy', data: { columns: [col('t', 'text')] } };
const ready = {
  id: 'ready',
  data: { columns: [col('t', 'text')], derivedColumnIds: [], serverManagedColumnIds: [] },
};
const stale = {
  id: 'stale',
  data: {
    columns: [col('d', 'test_derived'), col('t', 'text')],
    derivedColumnIds: [],
    serverManagedColumnIds: [],
  },
};
// FW2: `button` is server-managed. This board already has the FW1 field but not the FW2 one.
const needsManaged = {
  id: 'needsManaged',
  data: { columns: [col('b', 'button'), col('t', 'text')], derivedColumnIds: [] },
};
const forged = {
  id: 'forged',
  data: { columns: [col('t', 'text')], derivedColumnIds: ['t'], serverManagedColumnIds: ['t'] },
};

test('the plan only lists boards whose field is missing or wrong', () => {
  assert.deepEqual(planBackfill([legacy, ready, stale, forged, needsManaged]), [
    {
      id: 'legacy',
      derivedColumnIds: [],
      serverManagedColumnIds: [],
      had: undefined,
      hadServerManaged: undefined,
    },
    {
      id: 'stale',
      derivedColumnIds: ['d'],
      serverManagedColumnIds: [],
      had: [],
      hadServerManaged: [],
    },
    {
      id: 'forged',
      derivedColumnIds: [],
      serverManagedColumnIds: [],
      had: ['t'],
      hadServerManaged: ['t'],
    },
    {
      id: 'needsManaged',
      derivedColumnIds: [],
      serverManagedColumnIds: ['b'],
      had: [],
      hadServerManaged: undefined,
    },
  ]);
  assert.deepEqual(planBackfill([]), []);
});

test('a dry run writes nothing', async () => {
  const client = fakeClient([legacy, stale, needsManaged]);
  const result = await runBackfill({ client, log: quiet });
  assert.equal(result.changes.length, 3);
  assert.equal(result.applied, false);
  assert.equal(client.commits.length, 0);
  assert.equal(client.store.get('legacy').derivedColumnIds, undefined);
  assert.equal(client.store.get('needsManaged').serverManagedColumnIds, undefined);
});

test('--apply patches only the boards that need it, and a second run finds nothing', async () => {
  const client = fakeClient([legacy, ready, stale, needsManaged]);
  await runBackfill({ client, apply: true, log: quiet });
  assert.deepEqual(client.store.get('legacy').derivedColumnIds, []);
  assert.deepEqual(client.store.get('legacy').serverManagedColumnIds, []);
  assert.deepEqual(client.store.get('stale').derivedColumnIds, ['d']);
  assert.deepEqual(client.store.get('needsManaged').serverManagedColumnIds, ['b']);
  assert.deepEqual(
    client.commits
      .flat()
      .map((w) => w.path)
      .sort(),
    ['boards/legacy', 'boards/needsManaged', 'boards/stale'],
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

test('the REST client patches with a field mask and a "must exist" precondition, and pages the scan', async () => {
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (init.method === 'GET') {
      const second = String(url).includes('pageToken=p2');
      return Response.json(
        second
          ? {
              documents: [
                {
                  name: `projects/p/databases/${FIRESTORE_DATABASE_ID}/documents/boards/b2`,
                  fields: {},
                },
              ],
            }
          : {
              documents: [
                {
                  name: `projects/p/databases/${FIRESTORE_DATABASE_ID}/documents/boards/b1`,
                  fields: { derivedColumnIds: { arrayValue: {} } },
                },
              ],
              nextPageToken: 'p2',
            },
      );
    }
    return Response.json({});
  };
  const client = createFirestoreRest({
    origin: 'https://firestore.googleapis.com',
    project: 'p',
    getToken: () => 'tok',
    fetch: fakeFetch,
  });

  const docs = await client.listAllDocs('boards', { fields: ['columns', 'derivedColumnIds'] });
  assert.deepEqual(
    docs.map((d) => d.id),
    ['b1', 'b2'],
  );
  assert.deepEqual(docs[0].data.derivedColumnIds, []);
  assert.match(requests[0].url, /mask\.fieldPaths=columns&mask\.fieldPaths=derivedColumnIds/);

  await client.commit([{ op: 'patch', path: 'boards/b1', data: { derivedColumnIds: ['d'] } }]);
  const body = JSON.parse(requests.at(-1).init.body);
  assert.deepEqual(body.writes, [
    {
      update: {
        name: `projects/p/databases/${FIRESTORE_DATABASE_ID}/documents/boards/b1`,
        fields: { derivedColumnIds: { arrayValue: { values: [{ stringValue: 'd' }] } } },
      },
      updateMask: { fieldPaths: ['derivedColumnIds'] },
      currentDocument: { exists: true },
    },
  ]);
});
