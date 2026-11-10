// Tests for the Atrium MCP connector: the builders, the value conversion and the guard rails, against
// an in-memory Firestore. Nothing here touches the emulator or production.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRESTORE_DATABASE_ID, boardSchema, itemSchema } from '@atrium/shared';
import { createFirestoreRest, maskPath } from '../showcase/firestore-rest.mjs';
import { createFakeClient } from './fake-client.mjs';
import { buildColumnSettings, ts } from './lib/builders.mjs';
import { readConfig } from './lib/config.mjs';
import { createService } from './lib/service.mjs';
import { defineTools } from './lib/tools.mjs';

const WS = 'ws1';
const ME = 'user-me';
const OTHER = 'user-other';
const NOW = new Date('2026-11-01T10:00:00Z');
const config = {
  workspaceId: WS,
  uid: ME,
  project: 'atrium-board',
  database: FIRESTORE_DATABASE_ID,
  emulator: null,
};

const workspaceDoc = (roles = { [ME]: 'owner', [OTHER]: 'member' }) => ({
  ownerId: ME,
  roles,
  memberIds: Object.keys(roles),
});

function setup({ roles, extra = {} } = {}) {
  const client = createFakeClient({
    [`workspaces/${WS}`]: workspaceDoc(roles),
    [`users/${ME}`]: { displayName: 'Avery Quinn', photoURL: null },
    ...extra,
  });
  const service = createService({ client, config, now: () => NOW });
  return { client, service };
}

async function boardWithStructure(service) {
  const { id } = await service.createBoard({ name: 'Launch plan' });
  await service.addColumn({
    boardId: id,
    title: 'Stage',
    type: 'dropdown',
    settings: { addLabels: ['Idea', 'Build'] },
  });
  return id;
}

// ---- configuration ----------------------------------------------------------------------------

test('config: refuses to start without a workspace or user, and only local emulators', () => {
  assert.throws(() => readConfig({}), /ATRIUM_WORKSPACE_ID is not set/);
  assert.throws(() => readConfig({ ATRIUM_WORKSPACE_ID: 'w' }), /ATRIUM_USER_UID is not set/);
  assert.throws(
    () =>
      readConfig({
        ATRIUM_WORKSPACE_ID: 'w',
        ATRIUM_USER_UID: 'u',
        ATRIUM_EMULATOR: 'example.com:8080',
      }),
    /not a local address/,
  );
  assert.throws(
    () => readConfig({ ATRIUM_WORKSPACE_ID: '../x', ATRIUM_USER_UID: 'u' }),
    /plain id/,
  );
  const ok = readConfig({ ATRIUM_WORKSPACE_ID: 'w', ATRIUM_USER_UID: 'u' });
  assert.equal(ok.project, 'atrium-board');
  assert.equal(ok.database, FIRESTORE_DATABASE_ID);
});

// ---- boards -----------------------------------------------------------------------------------

test('createBoard builds the same document as the web app, without sample items', async () => {
  const { client, service } = setup();
  const created = await service.createBoard({ name: '  Launch plan  ', description: 'Q4' });
  const stored = client.docs.get(`boards/${created.id}`).data;
  assert.equal(stored.name, 'Launch plan');
  assert.deepEqual(stored.access, { [ME]: 'owner' });
  assert.deepEqual(stored.accessUids, [ME]);
  assert.deepEqual(stored.derivedColumnIds, []);
  assert.deepEqual(stored.serverManagedColumnIds, []);
  assert.deepEqual(stored.requiredColumnIds, []);
  assert.equal(stored.workspaceId, WS);
  assert.equal(stored.folderId, null);
  assert.equal(stored.state, 'active');
  assert.equal(stored.columns.length, 3);
  assert.equal(stored.groups.length, 2);
  const withStamps = {
    ...stored,
    createdAt: ts(stored.createdAt),
    updatedAt: ts(stored.updatedAt),
  };
  assert.ok(
    boardSchema.safeParse(withStamps).success,
    'stored board parses with the shared schema',
  );
  const items = [...client.docs.keys()].filter((p) => p.includes('/items/'));
  assert.equal(items.length, 0);
});

test('createBoard positions a new board after the last root board', async () => {
  const { service, client } = setup();
  const a = await service.createBoard({ name: 'A' });
  const b = await service.createBoard({ name: 'B' });
  const pa = client.docs.get(`boards/${a.id}`).data.position;
  const pb = client.docs.get(`boards/${b.id}`).data.position;
  assert.ok(pb > pa);
  const list = await service.listBoards();
  assert.deepEqual(
    list.map((x) => x.name),
    ['A', 'B'],
  );
});

test('listBoards only shows active boards of the configured workspace', async () => {
  const { service } = setup({
    extra: {
      'boards/foreign': {
        workspaceId: 'other-ws',
        state: 'active',
        kind: 'main',
        access: { [ME]: 'owner' },
        name: 'Foreign',
        position: 'a0',
        folderId: null,
      },
      'boards/gone': {
        workspaceId: WS,
        state: 'deleted',
        kind: 'main',
        access: { [ME]: 'owner' },
        name: 'Gone',
        position: 'a1',
        folderId: null,
      },
      'boards/private-other': {
        workspaceId: WS,
        state: 'active',
        kind: 'private',
        access: { [OTHER]: 'owner' },
        name: 'Secret',
        position: 'a2',
        folderId: null,
      },
    },
  });
  await service.createBoard({ name: 'Mine' });
  assert.deepEqual(
    (await service.listBoards()).map((b) => b.name),
    ['Mine'],
  );
});

// ---- guards -----------------------------------------------------------------------------------

test('guards: a board of another workspace, or a missing one, looks the same', async () => {
  const { service } = setup({
    extra: {
      'boards/foreign': {
        workspaceId: 'other-ws',
        state: 'active',
        kind: 'main',
        access: { [ME]: 'owner' },
        columns: [],
        groups: [],
      },
    },
  });
  await assert.rejects(
    service.getBoard({ boardId: 'foreign' }),
    /not found in the configured workspace/,
  );
  await assert.rejects(
    service.getBoard({ boardId: 'nope' }),
    /not found in the configured workspace/,
  );
  await assert.rejects(service.getBoard({ boardId: '../x' }), /plain id/);
});

test('guards: a non-active board is refused', async () => {
  const { service } = setup({
    extra: {
      'boards/arch': {
        workspaceId: WS,
        state: 'archived',
        kind: 'main',
        access: { [ME]: 'owner' },
        columns: [],
        groups: [],
      },
    },
  });
  await assert.rejects(service.getBoard({ boardId: 'arch' }), /archived, not active/);
});

test('guards: a viewer cannot write, an editor cannot change structure', async () => {
  const base = {
    workspaceId: WS,
    state: 'active',
    kind: 'private',
    position: 'a0',
    folderId: null,
    name: 'B',
    description: '',
    columns: [],
    subitemColumns: [],
    groups: [{ id: 'g1', title: 'G', color: '#579bfc', position: 'a0' }],
  };
  const { service } = setup({
    extra: {
      'boards/viewing': { ...base, access: { [ME]: 'viewer' } },
      'boards/editing': { ...base, access: { [ME]: 'editor' } },
    },
  });
  await assert.rejects(
    service.createItems({ boardId: 'viewing', items: [{ name: 'x' }] }),
    /only view/,
  );
  await service.getBoard({ boardId: 'viewing' }); // reading is fine
  await assert.rejects(service.addGroup({ boardId: 'editing', title: 'New' }), /owner role/);
  const created = await service.createItems({ boardId: 'editing', items: [{ name: 'x' }] });
  assert.equal(created.created.length, 1);
});

test('guards: a viewer of the workspace cannot use the connector at all', async () => {
  const { service } = setup({ roles: { [ME]: 'viewer' } });
  await assert.rejects(service.listBoards(), /only a viewer/);
});

test('guards: a non-member uid is refused', async () => {
  const { service } = setup({ roles: { [OTHER]: 'owner' } });
  await assert.rejects(service.createBoard({ name: 'x' }), /not a member/);
});

// ---- groups and columns -----------------------------------------------------------------------

test('groups: add, rename, and delete only when empty and not the last', async () => {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  const group = await service.addGroup({ boardId, title: 'Backlog', color: 'purple' });
  assert.equal(group.color, '#a25ddc');
  const renamed = await service.renameGroup({ boardId, group: 'backlog', title: 'Later' });
  assert.equal(renamed.title, 'Later');
  await service.createItems({ boardId, items: [{ name: 'Task', group: 'Later' }] });
  const groups = client.docs.get(`boards/${boardId}`).data.groups;
  await assert.rejects(
    service.deleteGroup({ boardId, group: 'Group Title' }),
    /More than one group/,
  );
  await assert.rejects(service.deleteGroup({ boardId, group: 'Later' }), /still has 1 item/);
  await service.deleteGroup({ boardId, group: groups[0].id });
  await service.deleteGroup({ boardId, group: groups[1].id });
  await assert.rejects(service.deleteGroup({ boardId, group: 'Later' }), /at least one group/);
  assert.equal(client.docs.get(`boards/${boardId}`).data.groups.length, 1);
});

test('columns: only simple types; derived and server-managed types are refused', async () => {
  const { service } = setup();
  const { id } = await service.createBoard({ name: 'B' });
  for (const type of ['formula', 'time_tracking', 'files', 'button', 'mirror']) {
    await assert.rejects(service.addColumn({ boardId: id, title: 'X', type }), /not supported/);
  }
  const status = await service.addColumn({
    boardId: id,
    title: 'Phase',
    type: 'status',
    settings: { addLabels: ['Todo', { label: 'Doing', color: 'blue' }, 'Done'] },
  });
  assert.deepEqual(
    status.labels.map((l) => l.label),
    ['Todo', 'Doing', 'Done'],
  );
  assert.equal(status.labels[1].color, '#579bfc');
});

test('columns: status labels get fresh indexes and adding is idempotent', async () => {
  const { service, client } = setup();
  const { id } = await service.createBoard({ name: 'B' });
  await service.updateColumnSettings({
    boardId: id,
    column: 'Status',
    settings: { addLabels: ['Blocked', 'working on it'] },
  });
  const status = client.docs.get(`boards/${id}`).data.columns.find((c) => c.id === 'status');
  const labels = status.settings.labels;
  assert.equal(labels.filter((l) => l.label.toLowerCase() === 'working on it').length, 1);
  const blocked = labels.find((l) => l.label === 'Blocked');
  assert.ok(blocked.index > 5, 'index is above the existing default grey index 5');
  assert.equal(new Set(labels.map((l) => l.index)).size, labels.length);
  assert.equal(new Set(labels.map((l) => l.id)).size, labels.length);
});

test('columns: labels cannot be replaced or removed, and the type cannot change', async () => {
  const { service } = setup();
  const { id } = await service.createBoard({ name: 'B' });
  await assert.rejects(
    service.updateColumnSettings({ boardId: id, column: 'Status', settings: { labels: [] } }),
    /addLabels/,
  );
  await assert.rejects(
    service.updateColumnSettings({ boardId: id, column: 'Status', settings: { type: 'text' } }),
    /cannot be set directly/,
  );
});

test('columns: unknown and ambiguous titles are refused with a plain message', async () => {
  const { service } = setup();
  const { id } = await service.createBoard({ name: 'B' });
  await service.addColumn({ boardId: id, title: 'Notes', type: 'text' });
  await service.addColumn({ boardId: id, title: 'notes', type: 'text' });
  await assert.rejects(
    service.createItems({ boardId: id, items: [{ name: 'x', values: { Nope: 'a' } }] }),
    /No column "Nope"/,
  );
  await assert.rejects(
    service.createItems({ boardId: id, items: [{ name: 'x', values: { NOTES: 'a' } }] }),
    /More than one column is called "NOTES"/,
  );
});

test('column settings go through the type schema', () => {
  assert.throws(() => buildColumnSettings('rating', { limit: 99 }), /Invalid settings/);
  assert.deepEqual(buildColumnSettings('rating', { limit: 7 }), { limit: 7, symbol: 'stars' });
  assert.throws(() => buildColumnSettings('status', { labels: [] }), /addLabels/);
});

// ---- items ------------------------------------------------------------------------------------

test('createItems converts plain values, appends in order and validates', async () => {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  await service.addColumn({ boardId, title: 'Due', type: 'date' });
  await service.addColumn({ boardId, title: 'Span', type: 'timeline' });
  await service.addColumn({ boardId, title: 'Done?', type: 'checkbox' });
  await service.addColumn({ boardId, title: 'Notes', type: 'long_text' });
  const { created } = await service.createItems({
    boardId,
    items: [
      {
        name: 'First',
        values: {
          Status: 'Done',
          Due: '2026-11-05',
          Stage: 'Build',
          'Done?': true,
          Notes: 'hello',
          Span: ['2026-11-01', '2026-11-09'],
          Person: 'me',
        },
      },
      { name: 'Second', group: client.docs.get(`boards/${boardId}`).data.groups[0].id },
    ],
  });
  assert.equal(created.length, 2);
  const stored = (n) =>
    [...client.docs.entries()].find(([p, d]) => p.includes('/items/') && d.data.name === n)[1].data;
  const first = stored('First');
  assert.ok(
    itemSchema.safeParse({
      ...first,
      createdAt: ts(first.createdAt),
      updatedAt: ts(first.updatedAt),
    }).success,
  );
  assert.deepEqual(first.values.status, { index: 1 });
  const dueId = client.docs.get(`boards/${boardId}`).data.columns.find((c) => c.title === 'Due').id;
  assert.deepEqual(first.values[dueId], { date: '2026-11-05' });
  assert.deepEqual(first.values.person, { personsAndTeams: [{ id: ME, kind: 'person' }] });
  assert.equal(first.createdBy, ME);
  assert.equal(first.parentItemId, null);
  assert.equal('seq' in first, false, 'seq is server-assigned');
  assert.equal('boardSeq' in first, false);
  // Appends after the previous item of the same group.
  const second = stored('Second');
  assert.ok(second.position > first.position);
  const third = await service.createItems({ boardId, items: [{ name: 'Third' }] });
  const t = client.docs.get(`boards/${boardId}/items/${third.created[0].id}`).data;
  assert.ok(t.position > second.position);
});

test('createItems rejects bad values, derived columns and big batches; nothing is written', async () => {
  const { service, client } = setup({});
  const boardId = await boardWithStructure(service);
  const before = client.commits.length;
  await assert.rejects(
    service.createItems({ boardId, items: [{ name: 'x', values: { Status: 'Nonsense' } }] }),
    /not a label/,
  );
  await assert.rejects(
    service.createItems({ boardId, items: [{ name: 'x', values: { Date: '2026-13-45' } }] }),
    /Date/,
  );
  await assert.rejects(
    service.createItems({ boardId, items: [{ name: 'x', values: { Stage: 'Unknown' } }] }),
    /not an option/,
  );
  await assert.rejects(
    service.createItems({ boardId, items: [{ name: 'x', values: { Person: 'someone-else' } }] }),
    /member uids/,
  );
  await assert.rejects(
    service.createItems({
      boardId,
      items: Array.from({ length: 51 }, (_, i) => ({ name: `n${i}` })),
    }),
    /between 1 and 50/,
  );
  assert.equal(client.commits.length, before);
});

test('createItems refuses a derived column value (guard)', async () => {
  const board = {
    workspaceId: WS,
    state: 'active',
    kind: 'private',
    access: { [ME]: 'owner' },
    position: 'a0',
    folderId: null,
    name: 'B',
    description: '',
    columns: [{ id: 'f1', type: 'formula', title: 'Total', position: 'a0', settings: {} }],
    subitemColumns: [],
    groups: [{ id: 'g1', title: 'G', color: '#579bfc', position: 'a0' }],
  };
  const { service, client } = setup({ extra: { 'boards/b1': board } });
  await assert.rejects(
    service.createItems({ boardId: 'b1', items: [{ name: 'x', values: { Total: 5 } }] }),
    /calculated/,
  );
  assert.equal([...client.docs.keys()].filter((p) => p.includes('/items/')).length, 0);
});

test('a locked column is refused to editors but not owners', async () => {
  const board = (role) => ({
    workspaceId: WS,
    state: 'active',
    kind: 'private',
    access: { [ME]: role },
    position: 'a0',
    folderId: null,
    name: 'B',
    description: '',
    columnLocks: ['t1'],
    columns: [{ id: 't1', type: 'text', title: 'Locked', position: 'a0', settings: {} }],
    subitemColumns: [],
    groups: [{ id: 'g1', title: 'G', color: '#579bfc', position: 'a0' }],
  });
  const { service } = setup({
    extra: { 'boards/ed': board('editor'), 'boards/ow': board('owner') },
  });
  await assert.rejects(
    service.createItems({ boardId: 'ed', items: [{ name: 'x', values: { Locked: 'v' } }] }),
    /locked/,
  );
  await service.createItems({ boardId: 'ow', items: [{ name: 'x', values: { Locked: 'v' } }] });
});

test('updateItem sends field paths, never the whole values map', async () => {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  const { created } = await service.createItems({
    boardId,
    items: [{ name: 'Task', values: { Status: 'Done', Stage: 'Idea' } }],
  });
  const itemId = created[0].id;
  client.commits.length = 0;
  await service.updateItem({ boardId, itemId, values: { Status: 'Stuck', Stage: null } });
  const [write] = client.commits[0];
  assert.equal(write.op, 'update');
  assert.deepEqual(
    Object.keys(write.set).filter((k) => k.startsWith('values')),
    ['values.status'],
  );
  assert.ok(write.remove.some((p) => p.startsWith('values.')));
  assert.equal('values' in write.set, false);
  const stored = client.docs.get(`boards/${boardId}/items/${itemId}`).data;
  assert.deepEqual(stored.values.status, { index: 2 });
  assert.equal(Object.keys(stored.values).length, 1, 'cleared cell is gone, others untouched');
  assert.equal(stored.updatedBy, ME);
});

test('updateItem moves an item to the end of another group and renames it', async () => {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  const groups = client.docs.get(`boards/${boardId}`).data.groups;
  const { created } = await service.createItems({
    boardId,
    items: [
      { name: 'A', group: groups[0].id },
      { name: 'B', group: groups[1].id },
    ],
  });
  await service.updateItem({ boardId, itemId: created[0].id, group: groups[1].id, name: 'A2' });
  const a = client.docs.get(`boards/${boardId}/items/${created[0].id}`).data;
  const b = client.docs.get(`boards/${boardId}/items/${created[1].id}`).data;
  assert.equal(a.groupId, groups[1].id);
  assert.equal(a.name, 'A2');
  assert.ok(a.position > b.position);
  await assert.rejects(service.updateItem({ boardId, itemId: created[0].id }), /Nothing to change/);
});

test('archive and delete are soft; a deleted item cannot be edited', async () => {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  const { created } = await service.createItems({ boardId, items: [{ name: 'A' }, { name: 'B' }] });
  await service.setItemState({ boardId, itemId: created[0].id, state: 'archived' });
  await service.setItemState({ boardId, itemId: created[1].id, state: 'deleted' });
  const a = client.docs.get(`boards/${boardId}/items/${created[0].id}`).data;
  const b = client.docs.get(`boards/${boardId}/items/${created[1].id}`).data;
  assert.equal(a.state, 'archived');
  assert.equal(a.deletedAt, null);
  assert.equal(b.state, 'deleted');
  assert.ok(b.deletedAt instanceof Date);
  assert.ok(client.docs.has(`boards/${boardId}/items/${created[1].id}`), 'never a hard delete');
  await assert.rejects(
    service.updateItem({ boardId, itemId: created[1].id, name: 'x' }),
    /is deleted/,
  );
  const board = await service.getBoard({ boardId });
  assert.equal(board.items.length, 0);
});

test('addUpdate writes the post and bumps updatesCount together', async () => {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  const { created } = await service.createItems({ boardId, items: [{ name: 'A' }] });
  const itemId = created[0].id;
  const { id } = await service.addUpdate({ boardId, itemId, text: ' Kicked off ' });
  const post = client.docs.get(`boards/${boardId}/items/${itemId}/updates/${id}`).data;
  assert.equal(post.content, 'Kicked off');
  assert.equal(post.authorId, ME);
  assert.equal(post.authorName, 'Avery Quinn');
  assert.deepEqual(post.likes, []);
  assert.equal(post.repliesCount, 0);
  assert.equal(client.docs.get(`boards/${boardId}/items/${itemId}`).data.updatesCount, 1);
  assert.equal(client.commits.at(-1).length, 2, 'one atomic commit');
  await service.addUpdate({ boardId, itemId, text: 'again' });
  assert.equal(client.docs.get(`boards/${boardId}/items/${itemId}`).data.updatesCount, 2);
});

test('getBoard returns readable values keyed by column title, with subitems nested', async () => {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  const { created } = await service.createItems({
    boardId,
    items: [
      { name: 'Parent', values: { Status: 'Done', Stage: ['Idea', 'Build'], Date: '2026-11-05' } },
    ],
  });
  client.docs.set(`boards/${boardId}/items/sub1`, {
    data: {
      name: 'Child',
      groupId: 'x',
      position: 'a0',
      parentItemId: created[0].id,
      values: {},
      state: 'active',
    },
    updateTime: 't',
  });
  const out = await service.getBoard({ boardId });
  assert.equal(out.itemCount, 1);
  const [item] = out.items;
  assert.equal(item.values.Status, 'Done');
  assert.equal(item.values.Stage, 'Idea, Build');
  assert.equal(item.values.Date, '2026-11-05');
  assert.equal(item.subitems[0].name, 'Child');
  assert.ok(out.columns.find((c) => c.title === 'Stage').options.includes('Build'));
  const compact = await service.getBoard({ boardId, includeItems: false });
  assert.equal('items' in compact, false);
});

// ---- structure races --------------------------------------------------------------------------

test('structure changes retry once when the board changed in between', async () => {
  const { service, client } = setup();
  const { id } = await service.createBoard({ name: 'B' });
  const real = client.commit;
  let interfered = false;
  client.commit = async (writes) => {
    if (!interfered && writes[0].op === 'patch') {
      interfered = true;
      // Someone else edits the board between our read and our write.
      await real([
        { op: 'patch', path: `boards/${id}`, data: { description: 'edited elsewhere' } },
      ]);
    }
    return real(writes);
  };
  await service.addGroup({ boardId: id, title: 'Late' });
  const stored = client.docs.get(`boards/${id}`).data;
  assert.equal(stored.description, 'edited elsewhere');
  assert.ok(stored.groups.some((g) => g.title === 'Late'));
});

test('structure changes give up after a second conflict', async () => {
  const { service, client } = setup();
  const { id } = await service.createBoard({ name: 'B' });
  const real = client.commit;
  client.commit = async (writes) => {
    if (writes[0].op === 'patch' && writes[0].precondition?.updateTime) {
      await real([
        { op: 'patch', path: `boards/${id}`, data: { description: String(Math.random()) } },
      ]);
    }
    return real(writes);
  };
  await assert.rejects(service.addGroup({ boardId: id, title: 'Late' }), (e) => e.status === 409);
});

// ---- REST client additions --------------------------------------------------------------------

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
});

// ---- tool catalogue ---------------------------------------------------------------------------

test('tool catalogue: unique atrium_ names, every tool described, schemas validate input', () => {
  const tools = defineTools({});
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of tools) {
    assert.match(tool.name, /^atrium_[a-z_]+$/);
    assert.ok(tool.description.length > 20, tool.name);
    assert.equal(typeof tool.run, 'function');
  }
  const get = tools.find((t) => t.name === 'atrium_get_board');
  assert.equal(get.inputSchema.boardId.safeParse('../etc').success, false);
  assert.equal(get.inputSchema.boardId.safeParse('abc_DEF-1').success, true);
});

// ---- item descriptions --------------------------------------------------------------------------

async function itemFixture() {
  const ctx = setup();
  const boardId = await boardWithStructure(ctx.service);
  const { created } = await ctx.service.createItems({ boardId, items: [{ name: 'Task' }] });
  return { ...ctx, boardId, itemId: created[0].id };
}

test('setItemDescription stores { doc, text } built by the app, as a plain field write', async () => {
  const { service, client, boardId, itemId } = await itemFixture();
  client.commits.length = 0;
  const md =
    '# Plan\n\nSome **bold**, *italic*, `code` and [a link](https://example.com).\n\n' +
    '- one\n  - nested\n- [x] done\n\n1. first\n\n> quote\n\n```js\nlet a = 1;\n```\n\n---';
  await service.setItemDescription({ boardId, itemId, markdown: md });
  const [write] = client.commits[0];
  assert.deepEqual(Object.keys(write.set).sort(), ['description', 'updatedAt', 'updatedBy']);
  const { description } = client.docs.get(`boards/${boardId}/items/${itemId}`).data;
  assert.deepEqual(Object.keys(description).sort(), ['doc', 'text']);
  assert.equal(description.doc.type, 'doc');
  const types = description.doc.content.map((n) => n.type);
  assert.deepEqual(types, [
    'heading',
    'paragraph',
    'bulletList',
    'taskList',
    'orderedList',
    'blockquote',
    'codeBlock',
    'horizontalRule',
  ]);
  assert.match(description.text, /^Plan\nSome bold, italic, code and a link\./);
  const bullets = description.doc.content[2];
  assert.equal(bullets.content[0].content[1].type, 'bulletList', 'nested list');
  assert.ok(description.text.length <= 10_000);
  assert.equal(client.docs.get(`boards/${boardId}/items/${itemId}`).data.updatedBy, ME);
});

test('setItemDescription refuses unsafe links, keeping the text', async () => {
  const { service, client, boardId, itemId } = await itemFixture();
  await service.setItemDescription({ boardId, itemId, markdown: '[x](javascript:alert(1))' });
  const { description } = client.docs.get(`boards/${boardId}/items/${itemId}`).data;
  assert.ok(!JSON.stringify(description.doc).includes('"link"'));
});

test('getItemDescription round-trips markdown; empty markdown clears the description', async () => {
  const { service, client, boardId, itemId } = await itemFixture();
  assert.equal((await service.getItemDescription({ boardId, itemId })).hasDescription, false);
  await service.setItemDescription({ boardId, itemId, markdown: '## Title\n\n- a\n- b\n\n**x**' });
  const got = await service.getItemDescription({ boardId, itemId });
  assert.equal(got.markdown, '## Title\n\n- a\n- b\n\n**x**');
  assert.deepEqual(got.richNodes, []);
  const out = await service.setItemDescription({ boardId, itemId, markdown: '  ' });
  assert.equal(out.cleared, true);
  assert.equal(client.docs.get(`boards/${boardId}/items/${itemId}`).data.description, null);
});

test('setItemDescription append keeps rich content; replace refuses to drop it', async () => {
  const { service, client, boardId, itemId } = await itemFixture();
  const path = `boards/${boardId}/items/${itemId}`;
  const image = { type: 'image', attrs: { fileId: 'f1' } };
  client.docs.get(path).data.description = {
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }, image],
    },
    text: 'hi',
  };
  await assert.rejects(
    service.setItemDescription({ boardId, itemId, markdown: 'new' }),
    /contains image/,
  );
  await service.setItemDescription({ boardId, itemId, markdown: 'more', mode: 'append' });
  const { doc } = client.docs.get(path).data.description;
  assert.deepEqual(
    doc.content.map((n) => n.type),
    ['paragraph', 'image', 'paragraph'],
  );
  await service.setItemDescription({
    boardId,
    itemId,
    markdown: 'fresh',
    allowOverwriteRich: true,
  });
  assert.equal(client.docs.get(path).data.description.text, 'fresh');
});

test('setItemDescription enforces the item and role guard rails and the size cap', async () => {
  const { service, boardId, itemId } = await itemFixture();
  await assert.rejects(
    service.setItemDescription({ boardId, itemId: 'nope', markdown: 'x' }),
    /not found/,
  );
  await assert.rejects(
    service.setItemDescription({ boardId, itemId, markdown: 'x'.repeat(50_001) }),
    /over 50000/,
  );
  const viewer = setup({ roles: { [ME]: 'viewer' } });
  await assert.rejects(
    viewer.service.setItemDescription({ boardId: 'b', itemId: 'i', markdown: 'x' }),
    /viewer|not found|permission|role|access/i,
  );
});

test('the description tools are in the catalogue', () => {
  const names = defineTools(setup().service).map((t) => t.name);
  assert.ok(names.includes('atrium_set_item_description'));
  assert.ok(names.includes('atrium_get_item_description'));
});

// ---- updates, replies, subitems and the rest ----------------------------------------------------

const MEMBER = { displayName: 'Jordan Lee', email: 'jordan@example.com' };

async function feedFixture() {
  const ctx = await itemFixture();
  ctx.client.docs.set(`users/${OTHER}`, { data: MEMBER, updateTime: 'u' });
  return ctx;
}

test('addUpdate stores a rich body, resolves @[Name] to a mention chip and lists it back', async () => {
  const { service, client, boardId, itemId } = await feedFixture();
  const { id, mentioned } = await service.addUpdate({
    boardId,
    itemId,
    text: 'Hi @[Jordan Lee], **please** look',
  });
  assert.deepEqual(mentioned, [OTHER]);
  const post = client.docs.get(`boards/${boardId}/items/${itemId}/updates/${id}`).data;
  assert.equal(post.content, 'Hi @Jordan Lee, please look');
  assert.deepEqual(post.mentions, [OTHER]);
  const chip = post.contentDoc.content[0].content.find((n) => n.type === 'mention');
  assert.deepEqual(chip.attrs, { id: OTHER, label: 'Jordan Lee' });
  const { updates } = await service.listUpdates({ boardId, itemId });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].mine, true);
  assert.match(updates[0].markdown, /\*\*please\*\*/);
  assert.deepEqual(updates[0].mentions, [OTHER]);
});

test('mentions: unknown members, non-readers and ambiguous names are refused; nothing is written', async () => {
  const { service, client, boardId, itemId } = await feedFixture();
  await assert.rejects(
    service.addUpdate({ boardId, itemId, text: 'hey @[Nobody]' }),
    /not a member who can see this board/,
  );
  assert.equal(client.docs.get(`boards/${boardId}/items/${itemId}`).data.updatesCount, undefined);
  // On a private board only people with access can be mentioned.
  const board = client.docs.get(`boards/${boardId}`).data;
  board.kind = 'private';
  board.access = { [ME]: 'owner' };
  await assert.rejects(
    service.addUpdate({ boardId, itemId, text: '@[Jordan Lee]' }),
    /not a member who can see this board/,
  );
});

test('replies: posted under an update, bump repliesCount and list nested; editing keeps mentions fixed', async () => {
  const { service, client, boardId, itemId } = await feedFixture();
  const { id: updateId } = await service.addUpdate({ boardId, itemId, text: 'Question?' });
  const { id: replyId } = await service.addReply({
    boardId,
    itemId,
    updateId,
    text: 'Answer for @[jordan@example.com]',
  });
  const base = `boards/${boardId}/items/${itemId}/updates/${updateId}`;
  assert.equal(client.docs.get(base).data.repliesCount, 1);
  const reply = client.docs.get(`${base}/replies/${replyId}`).data;
  assert.equal(reply.updateId, updateId);
  assert.deepEqual(reply.mentions, [OTHER]);
  reply.createdAt = new Date('2026-10-01T00:00:00Z');
  await service.editUpdate({ boardId, itemId, updateId, replyId, text: 'Edited @[Jordan Lee]' });
  const edited = client.docs.get(`${base}/replies/${replyId}`).data;
  assert.equal(edited.content, 'Edited @Jordan Lee');
  assert.deepEqual(edited.mentions, [OTHER], 'mentions are never changed on edit');
  assert.equal(
    edited.contentDoc.content[0].content.some((n) => n.type === 'mention'),
    false,
  );
  const { updates } = await service.listUpdates({ boardId, itemId });
  assert.equal(updates[0].replies.length, 1);
  assert.equal(updates[0].replies[0].text, 'Edited @Jordan Lee');
  assert.equal(updates[0].replies[0].edited, true);
});

test("edit and delete only touch the configured user's own posts; counters move down safely", async () => {
  const { service, client, boardId, itemId } = await feedFixture();
  const { id: updateId } = await service.addUpdate({ boardId, itemId, text: 'Mine' });
  const { id: replyId } = await service.addReply({ boardId, itemId, updateId, text: 'Mine too' });
  const path = `boards/${boardId}/items/${itemId}/updates/theirs`;
  client.docs.set(path, {
    data: { itemId, authorId: OTHER, content: 'Theirs', likes: [], repliesCount: 0 },
    updateTime: 'x',
  });
  await assert.rejects(
    service.editUpdate({ boardId, itemId, updateId: 'theirs', text: 'x' }),
    /own updates/,
  );
  await assert.rejects(
    service.deleteUpdate({ boardId, itemId, updateId: 'theirs' }),
    /own updates/,
  );
  await assert.rejects(service.deleteUpdate({ boardId, itemId, updateId: 'missing' }), /not found/);
  await service.deleteUpdate({ boardId, itemId, updateId, replyId });
  assert.equal(
    client.docs.get(`boards/${boardId}/items/${itemId}/updates/${updateId}`).data.repliesCount,
    0,
  );
  await service.deleteUpdate({ boardId, itemId, updateId });
  assert.equal(client.docs.has(`boards/${boardId}/items/${itemId}/updates/${updateId}`), false);
  assert.equal(client.docs.get(`boards/${boardId}/items/${itemId}`).data.updatesCount, 0);
  // A counter already at 0 is left alone (the rules refuse a decrement from 0).
  await service.deleteUpdate({ boardId, itemId, updateId: 'theirs' }).catch(() => {});
  client.docs.get(path).data.authorId = ME;
  await service.deleteUpdate({ boardId, itemId, updateId: 'theirs' });
  assert.equal(client.docs.get(`boards/${boardId}/items/${itemId}`).data.updatesCount, 0);
});

test('updates: viewers cannot post and attachment metadata is listed without files', async () => {
  const { service, client, boardId, itemId } = await feedFixture();
  client.docs.set(`boards/${boardId}/items/${itemId}/updates/a1`, {
    data: {
      itemId,
      authorId: OTHER,
      authorName: 'Jordan Lee',
      content: 'With file',
      likes: [OTHER],
      repliesCount: 0,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: new Date('2026-10-01T00:00:00Z'),
      attachments: [
        {
          id: 'f1',
          name: 'spec.pdf',
          storagePath: 'secret/path',
          size: 10,
          mimeType: 'application/pdf',
        },
      ],
    },
    updateTime: 'x',
  });
  const { updates } = await service.listUpdates({ boardId, itemId });
  assert.deepEqual(updates[0].attachments, [
    { id: 'f1', name: 'spec.pdf', size: 10, mimeType: 'application/pdf' },
  ]);
  assert.equal(updates[0].likes, 1);
  assert.equal(updates[0].mine, false);
  assert.equal(JSON.stringify(updates).includes('secret/path'), false);
  await assert.rejects(
    service.editUpdate({ boardId, itemId, updateId: 'a1', text: 'x' }),
    /own updates/,
  );
  client.docs.get(`boards/${boardId}`).data.access = { [ME]: 'viewer' };
  client.docs.get(`boards/${boardId}`).data.kind = 'private';
  await assert.rejects(service.addUpdate({ boardId, itemId, text: 'x' }), /only view/);
  await assert.rejects(
    service.addReply({ boardId, itemId, updateId: 'a1', text: 'x' }),
    /only view/,
  );
});

test('subitems: first one adds the default columns; create, list, update, describe and follow the parent', async () => {
  const { service, client, boardId, itemId } = await itemFixture();
  const second = (await service.createItems({ boardId, items: [{ name: 'Other' }] })).created[0].id;
  assert.equal(client.docs.get(`boards/${boardId}`).data.subitemColumns.length, 0);
  const { created } = await service.createSubitems({
    boardId,
    itemId,
    subitems: [
      { name: 'Step 1', values: { Status: 'Done', Date: '2026-11-05' } },
      { name: 'Step 2' },
    ],
  });
  const board = client.docs.get(`boards/${boardId}`).data;
  assert.deepEqual(
    board.subitemColumns.map((c) => c.title),
    ['Owner', 'Status', 'Date'],
  );
  const parent = client.docs.get(`boards/${boardId}/items/${itemId}`).data;
  const sub = client.docs.get(`boards/${boardId}/items/${created[0].id}`).data;
  assert.equal(sub.parentItemId, itemId);
  assert.equal(sub.groupId, parent.groupId);
  assert.ok(
    sub.position < client.docs.get(`boards/${boardId}/items/${created[1].id}`).data.position,
  );
  const parsed = itemSchema.safeParse({ ...sub, createdAt: ts(NOW), updatedAt: ts(NOW) });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  const listed = await service.listSubitems({ boardId, itemId });
  assert.deepEqual(
    listed.subitems.map((s) => s.name),
    ['Step 1', 'Step 2'],
  );
  assert.equal(listed.subitems[0].values.Status, 'Done');
  assert.equal(listed.columns.length, 3);
  assert.equal((await service.getBoard({ boardId })).subitemColumns.length, 3);

  // Update a subitem's name and values through the subitem columns; groups are refused.
  await service.updateItem({
    boardId,
    itemId: created[1].id,
    name: 'Step 2b',
    values: { Status: 'Working on it' },
  });
  assert.equal(
    (await service.listSubitems({ boardId, itemId })).subitems[1].values.Status,
    'Working on it',
  );
  await assert.rejects(
    service.updateItem({ boardId, itemId: created[1].id, group: 'Group 2' }),
    /stays in its parent's group/,
  );
  // An item column name does not work on a subitem and the reverse.
  await assert.rejects(
    service.updateItem({ boardId, itemId: created[1].id, values: { Stage: 'Idea' } }),
    /No column "Stage"/,
  );
  // Descriptions work on a subitem id.
  await service.setItemDescription({ boardId, itemId: created[0].id, markdown: '# Notes\n- a' });
  const description = await service.getItemDescription({ boardId, itemId: created[0].id });
  assert.match(description.markdown, /# Notes/);

  // Moving the parent moves its subitems; archiving it takes them along.
  const groups = (await service.getBoard({ boardId, includeItems: false })).groups;
  const target = groups.find((g) => g.id !== parent.groupId);
  await service.updateItem({ boardId, itemId, group: target.id });
  assert.equal(client.docs.get(`boards/${boardId}/items/${created[0].id}`).data.groupId, target.id);
  const archived = await service.setItemState({ boardId, itemId, state: 'archived' });
  assert.equal(archived.subitemsAlso, 2);
  assert.equal(client.docs.get(`boards/${boardId}/items/${created[1].id}`).data.state, 'archived');
  assert.equal(client.docs.get(`boards/${boardId}/items/${second}`).data.state, 'active');
});

test('subitems: one level only, an editor cannot create the first columns, a subitem can be deleted alone', async () => {
  const { service, client, boardId, itemId } = await itemFixture();
  const { created } = await service.createSubitems({ boardId, itemId, subitems: [{ name: 'S' }] });
  await assert.rejects(
    service.createSubitems({ boardId, itemId: created[0].id, subitems: [{ name: 'deep' }] }),
    /one level deep/,
  );
  await assert.rejects(service.listSubitems({ boardId, itemId: created[0].id }), /no subitems/);
  await assert.rejects(
    service.createSubitems({ boardId, itemId, subitems: Array(51).fill({ name: 'x' }) }),
    /between 1 and 50/,
  );
  await assert.rejects(
    service.createSubitems({
      boardId,
      itemId,
      subitems: [{ name: 'x', values: { Status: 'Nope' } }],
    }),
    /not a label/,
  );
  await service.setItemState({ boardId, itemId: created[0].id, state: 'deleted' });
  assert.equal(client.docs.get(`boards/${boardId}/items/${itemId}`).data.state, 'active');
  assert.equal((await service.listSubitems({ boardId, itemId })).subitems.length, 0);

  // A board without subitem columns, for an editor who is not an owner.
  const fresh = await service.createBoard({ name: 'Other' });
  const doc = client.docs.get(`boards/${fresh.id}`).data;
  doc.access = { [ME]: 'editor' };
  const item = (await service.createItems({ boardId: fresh.id, items: [{ name: 'P' }] })).created[0]
    .id;
  await assert.rejects(
    service.createSubitems({ boardId: fresh.id, itemId: item, subitems: [{ name: 'x' }] }),
    /only a board owner can add them/,
  );
});

test('duplicateItem copies values and subitems next to the original, without calculated cells', async () => {
  const { service, client, boardId } = await itemFixture();
  const { created } = await service.createItems({
    boardId,
    items: [{ name: 'Original', values: { Status: 'Done', Stage: ['Idea'] } }, { name: 'After' }],
  });
  await service.createSubitems({
    boardId,
    itemId: created[0].id,
    subitems: [{ name: 'Child', values: { Status: 'Done' } }],
  });
  const copy = await service.duplicateItem({ boardId, itemId: created[0].id });
  assert.equal(copy.name, 'Original (copy)');
  assert.equal(copy.subitems, 1);
  const original = client.docs.get(`boards/${boardId}/items/${created[0].id}`).data;
  const copied = client.docs.get(`boards/${boardId}/items/${copy.id}`).data;
  const after = client.docs.get(`boards/${boardId}/items/${created[1].id}`).data;
  assert.deepEqual(copied.values, original.values);
  assert.ok(copied.position > original.position && copied.position < after.position);
  assert.equal(copied.seq, undefined);
  const kids = [...client.docs.values()].filter((d) => d.data.parentItemId === copy.id);
  assert.equal(kids.length, 1);
  assert.equal(kids[0].data.name, 'Child');
  // Duplicating a subitem lands it after its siblings under the same parent.
  const sub = [...client.docs.entries()].find(([, d]) => d.data.parentItemId === created[0].id)[0];
  const subCopy = await service.duplicateItem({ boardId, itemId: sub.split('/').at(-1) });
  assert.equal(subCopy.name, 'Child (copy)');
  assert.equal(
    client.docs.get(`boards/${boardId}/items/${subCopy.id}`).data.parentItemId,
    created[0].id,
  );
});

test('activity and members: read-only lookups, filtered and bounded', async () => {
  const { service, client, boardId, itemId } = await feedFixture();
  const base = `boards/${boardId}/activity`;
  for (const [i, n] of [
    [1, itemId],
    [2, 'other'],
    [3, itemId],
  ]) {
    client.docs.set(`${base}/e${i}`, {
      data: {
        kind: 'value_changed',
        createdAt: new Date(`2026-11-0${i}T00:00:00Z`),
        actorName: 'Avery Quinn',
        itemId: n,
        itemName: 'Task',
        parentItemId: null,
        columnTitle: 'Status',
        data: { fromText: 'A', toText: 'B' },
      },
      updateTime: 'x',
    });
  }
  const all = await service.getActivity({ boardId });
  assert.deepEqual(
    all.events.map((e) => e.id),
    ['e3', 'e2', 'e1'],
  );
  const one = await service.getActivity({ boardId, itemId, limit: 1 });
  assert.deepEqual(
    one.events.map((e) => e.id),
    ['e3'],
  );
  assert.equal(one.events[0].to, 'B');

  const everyone = await service.listMembers({});
  assert.deepEqual(everyone.members.map((m) => m.uid).sort(), [OTHER, ME].sort());
  assert.equal(everyone.members.find((m) => m.uid === ME).me, true);
  client.docs.get(`boards/${boardId}`).data.kind = 'private';
  client.docs.get(`boards/${boardId}`).data.access = { [ME]: 'owner' };
  const onBoard = await service.listMembers({ boardId });
  assert.deepEqual(
    onBoard.members.map((m) => m.uid),
    [ME],
  );
});

test('the new tools are in the catalogue with validating schemas', () => {
  const tools = defineTools({});
  for (const name of [
    'atrium_list_updates',
    'atrium_add_reply',
    'atrium_edit_update',
    'atrium_delete_update',
    'atrium_list_subitems',
    'atrium_create_subitems',
    'atrium_duplicate_item',
    'atrium_get_activity',
    'atrium_list_members',
  ]) {
    assert.ok(
      tools.some((t) => t.name === name),
      name,
    );
  }
  const reply = tools.find((t) => t.name === 'atrium_add_reply');
  assert.equal(reply.inputSchema.updateId.safeParse('../x').success, false);
});
