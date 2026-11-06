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
