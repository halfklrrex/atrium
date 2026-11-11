// The Firestore REST client's field-path updates and queries, against a recording fetch. Nothing here
// touches the emulator or production.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFirestoreRest, maskPath } from './firestore-rest.mjs';

test('maskPath quotes segments that are not plain identifiers', () => {
  assert.equal(maskPath('values.abc'), 'values.abc');
  assert.equal(maskPath('values.my-col'), 'values.`my-col`');
  assert.equal(maskPath('values.9lives'), 'values.`9lives`');
});

test('REST client: update writes nested field paths, deletes and increments; runQuery filters by equality', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith(':runQuery')
          ? [
              {
                document: {
                  name: 'projects/p/databases/d/documents/boards/b1',
                  fields: { name: { stringValue: 'B' } },
                  updateTime: 't',
                },
              },
              { readTime: 'x' },
            ]
          : {},
    };
  };
  const rest = createFirestoreRest({
    origin: 'http://x',
    project: 'p',
    database: 'd',
    getToken: () => 't',
    fetch,
  });
  await rest.commit([
    {
      op: 'update',
      path: 'boards/b/items/i',
      set: { name: 'N', 'values.my-col': { text: 'v' } },
      remove: ['values.old'],
      increment: { updatesCount: 1 },
    },
  ]);
  const [write] = calls[0].body.writes;
  assert.deepEqual(write.updateMask.fieldPaths, ['name', 'values.`my-col`', 'values.old']);
  assert.deepEqual(write.update.fields.values.mapValue.fields['my-col'].mapValue.fields.text, {
    stringValue: 'v',
  });
  assert.equal('old' in write.update.fields.values.mapValue.fields, false);
  assert.deepEqual(write.updateTransforms, [
    { fieldPath: 'updatesCount', increment: { integerValue: '1' } },
  ]);
  assert.deepEqual(write.currentDocument, { exists: true });
  const rows = await rest.runQuery('boards', { workspaceId: 'w' });
  assert.deepEqual(
    rows.map((r) => [r.id, r.data.name]),
    [['b1', 'B']],
  );
  const filter = calls[1].body.structuredQuery.where.compositeFilter.filters[0].fieldFilter;
  assert.equal(filter.op, 'EQUAL');
  assert.equal(filter.field.fieldPath, 'workspaceId');
  // `{ field: { arrayContains } }` becomes an ARRAY_CONTAINS filter (workspace memberships).
  await rest.runQuery('workspaces', { memberIds: { arrayContains: 'u1' }, state: 'active' });
  const [contains, equal] = calls[2].body.structuredQuery.where.compositeFilter.filters.map(
    (f) => f.fieldFilter,
  );
  assert.deepEqual(contains, {
    field: { fieldPath: 'memberIds' },
    op: 'ARRAY_CONTAINS',
    value: { stringValue: 'u1' },
  });
  assert.deepEqual(equal, {
    field: { fieldPath: 'state' },
    op: 'EQUAL',
    value: { stringValue: 'active' },
  });
});
