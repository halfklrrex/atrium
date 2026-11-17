// Tests for the Atrium MCP connector's core: the builders, the value conversion and the guard rails
// of the actor model, against an in-memory Firestore. Nothing here touches the emulator or production.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardSchema, builtInTemplate, columnRegistry, itemSchema } from '@atrium/shared';
import { createFakeClient } from './fake-client.mjs';
import { buildColumnSettings, ts } from './builders.mjs';
import { PICK_WORKSPACE_MESSAGE, createService } from './service.mjs';
import { defineTools, toolNamesByDomain } from './tools.mjs';

const WS = 'ws1';
const ME = 'user-me';
const OTHER = 'user-other';
const NOW = new Date('2026-11-01T10:00:00Z');
const actor = { uid: ME, workspaceFilter: null };
/** How many tools the catalogue has: read from the domain files, never a literal. */
const CATALOGUE_SIZE = Object.values(toolNamesByDomain({})).flat().length;

const workspaceDoc = (roles = { [ME]: 'owner', [OTHER]: 'member' }, name = 'Home') => ({
  name,
  ownerId: ME,
  roles,
  memberIds: Object.keys(roles),
});

function setup({ roles, extra = {}, actor: who = actor } = {}) {
  const client = createFakeClient({
    [`workspaces/${WS}`]: workspaceDoc(roles),
    [`users/${ME}`]: { displayName: 'Avery Quinn', photoURL: null },
    ...extra,
  });
  const service = createService({ client, actor: who, now: () => NOW });
  return { client, service };
}

/** A minimal active board document of workspace `ws` with the given `access` map. */
const boardDoc = (ws, access, more = {}) => ({
  workspaceId: ws,
  state: 'active',
  kind: 'private',
  access,
  accessUids: Object.keys(access),
  position: 'a0',
  folderId: null,
  name: 'B',
  description: '',
  columns: [{ id: 't1', type: 'text', title: 'Note', position: 'a0', settings: {} }],
  subitemColumns: [],
  groups: [{ id: 'g1', title: 'G', color: '#579bfc', position: 'a0' }],
  ...more,
});

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

// ---- actor ------------------------------------------------------------------------------------

test('createService needs a plain uid and, when given, a plain workspace filter', () => {
  const client = createFakeClient();
  assert.throws(() => createService({ client, actor: { uid: '../x' } }), /plain id/);
  assert.throws(() => createService({ client, actor: {} }), /plain id/);
  assert.throws(
    () => createService({ client, actor: { uid: ME, workspaceFilter: 'a/b' } }),
    /plain id/,
  );
  assert.ok(createService({ client, actor: { uid: ME } }));
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
  assert.equal(list.workspaceId, WS);
  assert.deepEqual(
    list.boards.map((x) => x.name),
    ['A', 'B'],
  );
});

test('listBoards only shows active boards the actor can see in the workspace', async () => {
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
    (await service.listBoards()).boards.map((b) => b.name),
    ['Mine'],
  );
});

// ---- guards -----------------------------------------------------------------------------------

test('guards: a board of a workspace the actor is not in, or a missing one, looks the same', async () => {
  const { service } = setup({
    extra: {
      // Listed in the board's access map, yet not a workspace member: the rules say no, so do we.
      'workspaces/other-ws': workspaceDoc({ [OTHER]: 'owner' }, 'Theirs'),
      'boards/foreign': boardDoc('other-ws', { [ME]: 'owner' }, { kind: 'main' }),
      'boards/orphan': boardDoc('gone-ws', { [ME]: 'owner' }, { kind: 'main' }),
    },
  });
  const notFound = /was not found in your workspaces/;
  await assert.rejects(service.getBoard({ boardId: 'foreign' }), notFound);
  await assert.rejects(service.getBoard({ boardId: 'orphan' }), notFound);
  await assert.rejects(service.getBoard({ boardId: 'nope' }), notFound);
  await assert.rejects(service.getBoard({ boardId: '../x' }), /plain id/);
  // A board the actor is not in at all is "not found" too, whatever its state.
  const { service: s2 } = setup({
    extra: { 'boards/secret': boardDoc(WS, { [OTHER]: 'owner' }, { state: 'archived' }) },
  });
  await assert.rejects(s2.getBoard({ boardId: 'secret' }), notFound);
});

test('guards: the actor is a viewer in workspace A and an owner in workspace B', async () => {
  const { service, client } = setup({
    roles: { [ME]: 'viewer', [OTHER]: 'owner' },
    extra: {
      'workspaces/ws2': workspaceDoc({ [ME]: 'owner' }, 'Mine'),
      'boards/a-main': boardDoc(WS, {}, { kind: 'main', name: 'A main' }),
      'boards/b-main': boardDoc('ws2', {}, { kind: 'main', name: 'B main' }),
    },
  });
  // A: read only, through the workspace role on the main board.
  const a = await service.getBoard({ boardId: 'a-main', includeItems: false });
  assert.equal(a.workspaceId, WS);
  await assert.rejects(
    service.createItems({ boardId: 'a-main', items: [{ name: 'x' }] }),
    /only view/,
  );
  await assert.rejects(service.addGroup({ boardId: 'a-main', title: 'New' }), /owner role/);
  await assert.rejects(service.createBoard({ name: 'x', workspaceId: WS }), /you are a viewer/);
  // B: full owner, in the same service instance.
  await service.createItems({ boardId: 'b-main', items: [{ name: 'x' }] });
  await service.addGroup({ boardId: 'b-main', title: 'New' });
  const created = await service.createBoard({ name: 'New in B', workspaceId: 'ws2' });
  assert.equal(client.docs.get(`boards/${created.id}`).data.workspaceId, 'ws2');
  // listBoards is per workspace, with the role of that workspace.
  assert.deepEqual(
    (await service.listBoards({ workspaceId: WS })).boards.map((b) => b.name),
    ['A main'],
  );
  assert.deepEqual(
    (await service.listBoards({ workspaceId: 'ws2' })).boards.map((b) => b.name).sort(),
    ['B main', 'New in B'],
  );
});

test('guards: a workspace filter hides every other workspace and its boards', async () => {
  const { service } = setup({
    actor: { uid: ME, workspaceFilter: 'ws2' },
    extra: {
      'workspaces/ws2': workspaceDoc({ [ME]: 'owner' }, 'Mine'),
      'boards/a-main': boardDoc(WS, {}, { kind: 'main', name: 'A main' }),
      'boards/b-main': boardDoc('ws2', {}, { kind: 'main', name: 'B main' }),
    },
  });
  assert.deepEqual(
    (await service.listWorkspaces()).workspaces.map((w) => w.id),
    ['ws2'],
  );
  // The filter workspace is the default, so no workspaceId is needed.
  const list = await service.listBoards();
  assert.equal(list.workspaceId, 'ws2');
  assert.deepEqual(
    list.boards.map((b) => b.name),
    ['B main'],
  );
  await assert.rejects(service.getBoard({ boardId: 'a-main' }), /not found in your workspaces/);
  await assert.rejects(service.listBoards({ workspaceId: WS }), /not found among your workspaces/);
  await assert.rejects(service.createBoard({ name: 'x', workspaceId: WS }), /not found among/);
  await service.getBoard({ boardId: 'b-main', includeItems: false });
  // A filter on a workspace the actor is not in: nothing works, and verify says so.
  const { service: outsider } = setup({ actor: { uid: ME, workspaceFilter: 'nope' } });
  await assert.rejects(outsider.listBoards(), /not a member of workspace "nope"/);
  await assert.rejects(outsider.verify(), /"nope" was not found among your workspaces/);
});

test('listWorkspaces: memberships by array-contains, with the role, sorted by name', async () => {
  const { service, client } = setup({
    extra: {
      'workspaces/ws2': workspaceDoc({ [ME]: 'member', [OTHER]: 'owner' }, 'Alpha'),
      'workspaces/ws3': workspaceDoc({ [OTHER]: 'owner' }, 'Not mine'),
      // In memberIds but without a role: not a membership the rules would honour.
      'workspaces/ws4': { name: 'Half', roles: {}, memberIds: [ME] },
    },
  });
  const { workspaces } = await service.listWorkspaces();
  assert.deepEqual(workspaces, [
    { id: 'ws2', name: 'Alpha', role: 'member' },
    { id: WS, name: 'Home', role: 'owner' },
  ]);
  const everything = await client.runQuery('workspaces', { memberIds: { arrayContains: ME } });
  assert.deepEqual(everything.map((w) => w.id).sort(), ['ws1', 'ws2', 'ws4']);
  assert.deepEqual(await client.runQuery('workspaces', { memberIds: { arrayContains: 'x' } }), []);
});

test('listBoards, createBoard and listMembers default to the only workspace, else ask for one', async () => {
  const one = setup();
  assert.equal((await one.service.listBoards()).workspaceId, WS);
  assert.equal((await one.service.listMembers()).workspaceId, WS);
  assert.equal((await one.service.createBoard({ name: 'x' })).workspaceId, WS);

  const two = setup({ extra: { 'workspaces/ws2': workspaceDoc({ [ME]: 'owner' }, 'Second') } });
  await assert.rejects(two.service.listBoards(), new RegExp(PICK_WORKSPACE_MESSAGE));
  await assert.rejects(two.service.createBoard({ name: 'x' }), new RegExp(PICK_WORKSPACE_MESSAGE));
  await assert.rejects(two.service.listMembers({}), new RegExp(PICK_WORKSPACE_MESSAGE));
  assert.equal((await two.service.listBoards({ workspaceId: 'ws2' })).workspaceId, 'ws2');
  await assert.rejects(two.service.listBoards({ workspaceId: 'nope' }), /not found among/);
  await assert.rejects(two.service.listBoards({ workspaceId: '../x' }), /plain id/);

  const none = setup({ roles: { [OTHER]: 'owner' } });
  await assert.rejects(none.service.listBoards(), /not a member of any workspace/);
});

test('createBoard needs the member role or higher in the workspace', async () => {
  for (const role of ['owner', 'admin', 'member']) {
    const { service, client } = setup({ roles: { [ME]: role } });
    const { id } = await service.createBoard({ name: 'ok' });
    assert.deepEqual(client.docs.get(`boards/${id}`).data.access, { [ME]: 'owner' });
  }
  const viewer = setup({ roles: { [ME]: 'viewer' } });
  await assert.rejects(viewer.service.createBoard({ name: 'x' }), /you are a viewer/);
  assert.equal(viewer.client.commits.length, 0);
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

test('guards: a viewer of the workspace reads and never writes', async () => {
  const { service, client } = setup({
    roles: { [ME]: 'viewer', [OTHER]: 'owner' },
    extra: { 'boards/m': boardDoc(WS, {}, { kind: 'main', name: 'Main' }) },
  });
  assert.deepEqual(
    (await service.listBoards()).boards.map((b) => b.id),
    ['m'],
  );
  await service.getBoard({ boardId: 'm' });
  await assert.rejects(service.createItems({ boardId: 'm', items: [{ name: 'x' }] }), /only view/);
  await assert.rejects(service.createBoard({ name: 'x' }), /you are a viewer/);
  assert.equal(client.commits.length, 0);
});

test('guards: a non-member uid sees nothing', async () => {
  const { service } = setup({ roles: { [OTHER]: 'owner' } });
  await assert.rejects(service.createBoard({ name: 'x' }), /not a member of any workspace/);
  await assert.rejects(service.createBoard({ name: 'x', workspaceId: WS }), /not found among/);
  assert.deepEqual((await service.listWorkspaces()).workspaces, []);
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

test('columns: a board never gets more vote columns than the rules protect', async () => {
  const { service, client } = setup();
  const { id } = await service.createBoard({ name: 'B' });
  const path = `boards/${id}`;
  const board = client.docs.get(path);
  const votes = Array.from({ length: 10 }, (_, n) => ({
    id: `v${n}`,
    type: 'vote',
    title: `Vote ${n}`,
    position: `a${n}`,
    settings: {},
  }));
  client.docs.set(path, {
    ...board,
    data: { ...board.data, columns: [...board.data.columns, ...votes] },
  });
  await assert.rejects(
    service.addColumn({ boardId: id, title: 'One more', type: 'vote' }),
    /A board can have at most 10 vote columns\./,
  );
  // Other types are not limited by the cap.
  await service.addColumn({ boardId: id, title: 'Notes', type: 'text' });
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

test('updateItem never empties a required cell (REQ-1), like the rules', async () => {
  const columns = [
    {
      id: 'st',
      type: 'status',
      title: 'Status',
      position: 'a0',
      settings: buildColumnSettings('status'),
    },
    { id: 'tx', type: 'text', title: 'Note', position: 'a1', settings: {}, required: true },
    { id: 'op', type: 'text', title: 'Optional', position: 'a2', settings: {} },
  ];
  const { service, client } = setup({
    extra: {
      'boards/b': boardDoc(WS, { [ME]: 'owner' }, { columns, requiredColumnIds: ['st'] }),
      'boards/b/items/i': {
        name: 'Task',
        groupId: 'g1',
        position: 'a0',
        parentItemId: null,
        state: 'active',
        values: { st: { index: 0 }, tx: 'keep me', op: 'x' },
      },
      'boards/b/items/empty': {
        name: 'Fresh',
        groupId: 'g1',
        position: 'a1',
        parentItemId: null,
        state: 'active',
        values: {},
      },
    },
  });
  const before = client.commits.length;
  // Listed in requiredColumnIds, and marked `required` on the column: both are refused.
  await assert.rejects(
    service.updateItem({ boardId: 'b', itemId: 'i', values: { Status: null } }),
    /"Status" is required and cannot be emptied/,
  );
  await assert.rejects(
    service.updateItem({ boardId: 'b', itemId: 'i', values: { Note: null, Optional: null } }),
    /"Note" is required/,
  );
  await assert.rejects(
    service.updateItem({ boardId: 'b', itemId: 'i', values: { Note: '   ' } }),
    /"Note" is required/,
  );
  assert.equal(client.commits.length, before, 'nothing was written');
  // Non-empty values and optional cells are fine; a required cell that is not stored at all
  // can be "cleared" (the rules see no change).
  await service.updateItem({ boardId: 'b', itemId: 'i', values: { Note: 'new', Optional: null } });
  assert.equal(client.docs.get('boards/b/items/i').data.values.tx, 'new');
  await service.updateItem({ boardId: 'b', itemId: 'empty', values: { Note: null, Status: 1 } });
  assert.deepEqual(client.docs.get('boards/b/items/empty').data.values, { st: { index: 1 } });
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

// ---- tool catalogue ---------------------------------------------------------------------------

test('tool catalogue: unique atrium_ names, every tool described, scoped and annotated', () => {
  const tools = defineTools({});
  const names = tools.map((t) => t.name);
  assert.equal(tools.length, CATALOGUE_SIZE);
  assert.equal(new Set(names).size, names.length);
  for (const tool of tools) {
    assert.match(tool.name, /^atrium_[a-z_]+$/);
    assert.ok(tool.description.length > 20, tool.name);
    assert.equal(typeof tool.run, 'function');
    assert.ok(['read', 'write'].includes(tool.scope), tool.name);
    assert.equal(tool.annotations.readOnlyHint, tool.scope === 'read', tool.name);
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean', tool.name);
    // A read tool says so in its description; a write tool never claims to be read-only.
    assert.equal(tool.description.startsWith('Read-only.'), tool.scope === 'read', tool.name);
    if (tool.scope === 'read') assert.equal(tool.annotations.destructiveHint, false, tool.name);
  }
  const get = tools.find((t) => t.name === 'atrium_get_board');
  assert.equal(get.inputSchema.boardId.safeParse('../etc').success, false);
  assert.equal(get.inputSchema.boardId.safeParse('abc_DEF-1').success, true);
  for (const name of ['atrium_list_boards', 'atrium_create_board', 'atrium_list_members']) {
    const tool = tools.find((t) => t.name === name);
    assert.equal(tool.inputSchema.workspaceId.safeParse(undefined).success, true, name);
    assert.equal(tool.inputSchema.workspaceId.safeParse('a/b').success, false, name);
  }
  assert.deepEqual(tools.find((t) => t.name === 'atrium_list_workspaces').inputSchema, {});
  assert.equal(
    tools.find((t) => t.name === 'atrium_delete_update').annotations.destructiveHint,
    true,
  );
  assert.equal(
    tools.find((t) => t.name === 'atrium_create_items').annotations.destructiveHint,
    false,
  );
});

test('tool catalogue: the workspace tools reach the service', async () => {
  const calls = [];
  const service = new Proxy(
    {},
    { get: (_, method) => async (args) => (calls.push([method, args]), { ok: method }) },
  );
  const tools = Object.fromEntries(defineTools(service).map((t) => [t.name, t]));
  assert.deepEqual(await tools.atrium_list_workspaces.run({}), { ok: 'listWorkspaces' });
  await tools.atrium_list_boards.run({ workspaceId: 'w' });
  await tools.atrium_list_members.run({});
  assert.deepEqual(calls.slice(1), [
    ['listBoards', { workspaceId: 'w' }],
    ['listMembers', {}],
  ]);
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
  ctx.client.docs.set(`workspaces/${WS}/members/${OTHER}`, { data: MEMBER, updateTime: 'u' });
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

test("edit and delete only touch the actor's own posts; counters move down safely", async () => {
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

test('subitems share the board columns; create, list, update, describe and follow the parent', async () => {
  const { service, client, boardId, itemId } = await itemFixture();
  const second = (await service.createItems({ boardId, items: [{ name: 'Other' }] })).created[0].id;
  const columnsBefore = structuredClone(client.docs.get(`boards/${boardId}`).data.columns);
  const { created } = await service.createSubitems({
    boardId,
    itemId,
    subitems: [
      { name: 'Step 1', values: { Status: 'Done', Date: '2026-11-05' } },
      { name: 'Step 2' },
    ],
  });
  // No default subitem columns: the board is unchanged.
  const board = client.docs.get(`boards/${boardId}`).data;
  assert.deepEqual(board.subitemColumns, []);
  assert.deepEqual(board.columns, columnsBefore);
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
  assert.equal(listed.columns.length, board.columns.length);
  const full = await service.getBoard({ boardId });
  assert.equal('subitemColumns' in full, false);
  const nested = full.items.find((i) => i.id === itemId).subitems;
  assert.equal(nested[0].values.Status, 'Done');

  // Update a subitem's name and values through the board columns; groups are refused.
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
  // Any board column works on a subitem.
  await service.updateItem({ boardId, itemId: created[1].id, values: { Stage: 'Idea' } });
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

test('subitems: one level only, an editor can create them, a subitem can be deleted alone', async () => {
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
  const made = await service.createSubitems({
    boardId: fresh.id,
    itemId: item,
    subitems: [{ name: 'x' }],
  });
  assert.equal(made.created.length, 1);
  assert.deepEqual(client.docs.get(`boards/${fresh.id}`).data.subitemColumns, []);
});

test('subitems on a board not yet migrated keep using its legacy subitem columns', async () => {
  const { service, client, boardId, itemId } = await itemFixture();
  const board = client.docs.get(`boards/${boardId}`).data;
  board.subitemColumns = [
    {
      id: 'legacy_note',
      type: 'text',
      title: 'Legacy note',
      position: 'a0',
      settings: {},
    },
  ];
  const { created } = await service.createSubitems({
    boardId,
    itemId,
    subitems: [{ name: 'Old', values: { 'Legacy note': 'hi' } }],
  });
  assert.equal(
    client.docs.get(`boards/${boardId}/items/${created[0].id}`).data.values.legacy_note,
    'hi',
  );
  const listed = await service.listSubitems({ boardId, itemId });
  assert.deepEqual(
    listed.columns.map((c) => c.title),
    ['Legacy note'],
  );
  const full = await service.getBoard({ boardId });
  assert.deepEqual(
    full.subitemColumns.map((c) => c.title),
    ['Legacy note'],
  );
  assert.equal(full.items.find((i) => i.id === itemId).subitems[0].values['Legacy note'], 'hi');
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
  assert.equal(everyone.workspaceId, WS);
  assert.deepEqual(everyone.members.map((m) => m.uid).sort(), [OTHER, ME].sort());
  assert.equal(everyone.members.find((m) => m.uid === ME).me, true);
  client.docs.get(`boards/${boardId}`).data.kind = 'private';
  client.docs.get(`boards/${boardId}`).data.access = { [ME]: 'owner' };
  const onBoard = await service.listMembers({ boardId });
  assert.equal(onBoard.workspaceId, WS);
  assert.deepEqual(
    onBoard.members.map((m) => m.uid),
    [ME],
  );
});

test('verify: the user must exist; it reports the memberships', async () => {
  const { service } = setup();
  assert.deepEqual(await service.verify(), {
    uid: ME,
    workspaces: [{ id: WS, name: 'Home', role: 'owner' }],
  });
  const ghost = setup({ actor: { uid: 'nobody' } });
  await assert.rejects(ghost.service.verify(), /User "nobody" does not exist/);
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

// ---- gap batch 1a: restore, move, reorder, likes, find a person ------------------------------

const itemDoc = (more = {}) => ({
  name: 'Task',
  groupId: 'g1',
  position: 'a0',
  parentItemId: null,
  state: 'active',
  values: {},
  ...more,
});

test('restoreItem brings back archived and trashed items with their subitems', async () => {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  const { created } = await service.createItems({ boardId, items: [{ name: 'A' }, { name: 'B' }] });
  const [a, b] = created.map((c) => c.id);
  await service.createSubitems({ boardId, itemId: a, subitems: [{ name: 'a1' }] });
  await service.setItemState({ boardId, itemId: a, state: 'archived' });
  await service.setItemState({ boardId, itemId: b, state: 'deleted' });
  const subId = [...client.docs.keys()].find(
    (k) => k.startsWith(`boards/${boardId}/items/`) && client.docs.get(k).data.parentItemId === a,
  );
  assert.equal(client.docs.get(subId).data.state, 'archived');

  const first = await service.restoreItem({ boardId, itemId: a });
  assert.deepEqual(first, { id: a, restoredFrom: 'archived', group: first.group, subitemsAlso: 1 });
  assert.equal(client.docs.get(`boards/${boardId}/items/${a}`).data.state, 'active');
  assert.equal(client.docs.get(subId).data.state, 'active');
  await service.restoreItem({ boardId, itemId: b });
  const stored = client.docs.get(`boards/${boardId}/items/${b}`).data;
  assert.equal(stored.state, 'active');
  assert.equal(stored.deletedAt, null);
  assert.equal(stored.updatedBy, ME);
  await assert.rejects(service.restoreItem({ boardId, itemId: b }), /already active/);
  await assert.rejects(service.restoreItem({ boardId, itemId: 'nope' }), /not found/);
});

test('restoreItem: a subitem needs an active parent; a lost group falls back to the first', async () => {
  const { service, client } = setup({
    extra: {
      'boards/b': boardDoc(WS, { [ME]: 'editor' }),
      'boards/b/items/p': itemDoc({ state: 'archived', groupId: 'gone' }),
      'boards/b/items/s': itemDoc({ state: 'archived', groupId: 'gone', parentItemId: 'p' }),
    },
  });
  await assert.rejects(service.restoreItem({ boardId: 'b', itemId: 's' }), /Restore the parent/);
  const result = await service.restoreItem({ boardId: 'b', itemId: 'p' });
  assert.equal(result.group, 'G');
  assert.equal(client.docs.get('boards/b/items/p').data.groupId, 'g1');
  assert.equal(client.docs.get('boards/b/items/s').data.groupId, 'g1');
  assert.equal(client.docs.get('boards/b/items/s').data.state, 'active');
});

test('restoreItem needs the editor role', async () => {
  const { service } = setup({
    extra: {
      'boards/b': boardDoc(WS, { [ME]: 'viewer' }),
      'boards/b/items/p': itemDoc({ state: 'deleted' }),
    },
  });
  await assert.rejects(service.restoreItem({ boardId: 'b', itemId: 'p' }), /only view/);
});

async function threeItems() {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  const groups = client.docs.get(`boards/${boardId}`).data.groups;
  const { created } = await service.createItems({
    boardId,
    items: [
      { name: 'A', group: groups[0].id },
      { name: 'B', group: groups[0].id },
      { name: 'C', group: groups[0].id },
      { name: 'X', group: groups[1].id },
    ],
  });
  const [a, b, c, x] = created.map((i) => i.id);
  const pos = (id) => client.docs.get(`boards/${boardId}/items/${id}`).data.position;
  const order = async () => {
    const board = await service.getBoard({ boardId });
    return board.items.map((i) => i.name);
  };
  return { service, client, boardId, groups, a, b, c, x, pos, order };
}

test('moveItem places an item first, last, before and after, in or across groups', async () => {
  const { service, boardId, groups, a, b, c, x, pos, order } = await threeItems();
  assert.deepEqual(await order(), ['A', 'B', 'C', 'X']);
  await service.moveItem({ boardId, itemId: c, position: 'first' });
  assert.deepEqual(await order(), ['C', 'A', 'B', 'X']);
  await service.moveItem({ boardId, itemId: c, position: 'last' });
  assert.deepEqual(await order(), ['A', 'B', 'C', 'X']);
  await service.moveItem({ boardId, itemId: c, beforeItemId: b });
  assert.deepEqual(await order(), ['A', 'C', 'B', 'X']);
  await service.moveItem({ boardId, itemId: a, afterItemId: b });
  assert.deepEqual(await order(), ['C', 'B', 'A', 'X']);
  assert.ok(pos(c) < pos(b) && pos(b) < pos(a));
  // Across groups: before X in the second group, then to the end of the first by title.
  const moved = await service.moveItem({
    boardId,
    itemId: a,
    group: groups[1].id,
    beforeItemId: x,
  });
  assert.equal(moved.group, groups[1].title);
  assert.deepEqual(await order(), ['C', 'B', 'A', 'X']);
  const board = await service.getBoard({ boardId });
  assert.deepEqual(
    board.items.map((i) => i.group),
    [groups[0].title, groups[0].title, groups[1].title, groups[1].title],
  );
  await service.moveItem({ boardId, itemId: a, group: groups[0].id });
  assert.deepEqual(await order(), ['C', 'B', 'A', 'X']);
  assert.ok(pos(a) > pos(b));
});

test('moveItem: subitems follow the parent; a subitem only reorders among siblings', async () => {
  const { service, client, boardId, groups, a } = await threeItems();
  const { created } = await service.createSubitems({
    boardId,
    itemId: a,
    subitems: [{ name: 's1' }, { name: 's2' }],
  });
  const [s1, s2] = created.map((s) => s.id);
  await service.moveItem({ boardId, itemId: a, group: groups[1].id });
  for (const id of [s1, s2]) {
    assert.equal(client.docs.get(`boards/${boardId}/items/${id}`).data.groupId, groups[1].id);
  }
  await service.moveItem({ boardId, itemId: s2, position: 'first' });
  const pos = (id) => client.docs.get(`boards/${boardId}/items/${id}`).data.position;
  assert.ok(pos(s2) < pos(s1));
  await assert.rejects(
    service.moveItem({ boardId, itemId: s1, group: groups[0].id }),
    /stays in its parent's group/,
  );
  await assert.rejects(
    service.moveItem({ boardId, itemId: s1, beforeItemId: a }),
    /not an active sibling subitem/,
  );
});

test('moveItem validates its placement and anchors', async () => {
  const { service, client, boardId, a, b, x } = await threeItems();
  const before = client.commits.length;
  await assert.rejects(
    service.moveItem({ boardId, itemId: a, position: 'first', beforeItemId: b }),
    /one of position/,
  );
  await assert.rejects(
    service.moveItem({ boardId, itemId: a, position: 'middle' }),
    /"first" or "last"/,
  );
  await assert.rejects(
    service.moveItem({ boardId, itemId: a, beforeItemId: x }),
    /not an active item of the target group/,
  );
  await assert.rejects(
    service.moveItem({ boardId, itemId: a, beforeItemId: a }),
    /not an active item/,
  );
  await assert.rejects(service.moveItem({ boardId, itemId: a, group: 'Nope' }), /No group/);
  assert.equal(client.commits.length, before, 'nothing was written');
});

test('moveItem is refused to a viewer', async () => {
  const { service } = setup({
    extra: {
      'boards/b': boardDoc(WS, { [ME]: 'viewer' }),
      'boards/b/items/p': itemDoc(),
    },
  });
  await assert.rejects(
    service.moveItem({ boardId: 'b', itemId: 'p', position: 'first' }),
    /only view/,
  );
});

test('reorderGroups rewrites positions for the full list and needs the owner role', async () => {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  const { id: third } = await service.addGroup({ boardId, title: 'Third' });
  const groups = client.docs.get(`boards/${boardId}`).data.groups;
  const [g1, g2] = groups;
  const result = await service.reorderGroups({ boardId, groups: ['Third', g2.id, g1.id] });
  assert.deepEqual(
    result.groups.map((g) => g.id),
    [third, g2.id, g1.id],
  );
  const stored = client.docs.get(`boards/${boardId}`).data.groups;
  assert.equal(stored.length, 3);
  const sorted = [...stored].sort((p, q) => (p.position < q.position ? -1 : 1));
  assert.deepEqual(
    sorted.map((g) => g.id),
    [third, g2.id, g1.id],
  );
  assert.equal(stored.find((g) => g.id === g1.id).color, g1.color, 'titles and colors are kept');
  const board = await service.getBoard({ boardId });
  assert.deepEqual(
    board.groups.map((g) => g.id),
    [third, g2.id, g1.id],
  );
  const before = client.commits.length;
  await assert.rejects(
    service.reorderGroups({ boardId, groups: [g1.id, g2.id] }),
    /missing: "Third"/,
  );
  await assert.rejects(
    service.reorderGroups({ boardId, groups: [g1.id, g1.id, g2.id] }),
    /listed twice/,
  );
  await assert.rejects(
    service.reorderGroups({ boardId, groups: [g1.id, g2.id, 'Zzz'] }),
    /No group/,
  );
  assert.equal(client.commits.length, before);
  const editor = setup({ extra: { 'boards/e': boardDoc(WS, { [ME]: 'editor' }) } });
  await assert.rejects(
    editor.service.reorderGroups({ boardId: 'e', groups: ['g1'] }),
    /board owner role/,
  );
});

test('likes: like and unlike an update or a reply, idempotently', async () => {
  const { service, client } = setup();
  const boardId = await boardWithStructure(service);
  const { created } = await service.createItems({ boardId, items: [{ name: 'A' }] });
  const itemId = created[0].id;
  const { id: updateId } = await service.addUpdate({ boardId, itemId, text: 'hello' });
  const { id: replyId } = await service.addReply({ boardId, itemId, updateId, text: 'hi' });
  const post = () => client.docs.get(`boards/${boardId}/items/${itemId}/updates/${updateId}`).data;
  const reply = () =>
    client.docs.get(`boards/${boardId}/items/${itemId}/updates/${updateId}/replies/${replyId}`)
      .data;
  client.docs.get(`boards/${boardId}/items/${itemId}/updates/${updateId}`).data.likes = [OTHER];

  const args = { boardId, itemId, updateId };
  assert.deepEqual(await service.setUpdateLike({ ...args, liked: true }), {
    id: updateId,
    liked: true,
    likes: 2,
    changed: true,
  });
  assert.deepEqual(post().likes, [OTHER, ME]);
  assert.equal((await service.setUpdateLike({ ...args, liked: true })).changed, false);
  assert.deepEqual(post().likes, [OTHER, ME]);
  assert.deepEqual(await service.setUpdateLike({ ...args, liked: false }), {
    id: updateId,
    liked: false,
    likes: 1,
    changed: true,
  });
  assert.deepEqual(post().likes, [OTHER], 'only my uid left');
  assert.equal((await service.setUpdateLike({ ...args, liked: false })).changed, false);
  await service.setUpdateLike({ ...args, replyId, liked: true });
  assert.deepEqual(reply().likes, [ME]);
  assert.equal((await service.listUpdates({ boardId, itemId })).updates[0].likes, 1);
  await assert.rejects(
    service.setUpdateLike({ ...args, updateId: 'nope', liked: true }),
    /not found/,
  );
  await assert.rejects(service.setUpdateLike({ ...args, replyId: 'nope', liked: true }), /Reply/);
});

test('likes retry once when the post changed in between, and need the editor role', async () => {
  const { service, client } = setup({
    extra: {
      'boards/b': boardDoc(WS, { [ME]: 'editor' }),
      'boards/b/items/i': itemDoc(),
      'boards/b/items/i/updates/u': { authorId: OTHER, content: 'x', likes: [] },
      'boards/v': boardDoc(WS, { [ME]: 'viewer' }),
      'boards/v/items/i': itemDoc(),
      'boards/v/items/i/updates/u': { authorId: OTHER, content: 'x', likes: [] },
    },
  });
  const real = client.commit.bind(client);
  let raced = false;
  client.commit = async (writes) => {
    if (!raced) {
      raced = true;
      // Someone else likes it between our read and write.
      await real([
        { op: 'update', path: 'boards/b/items/i/updates/u', set: { likes: [OTHER] }, remove: [] },
      ]);
    }
    return real(writes);
  };
  const result = await service.setUpdateLike({
    boardId: 'b',
    itemId: 'i',
    updateId: 'u',
    liked: true,
  });
  assert.equal(result.likes, 2);
  assert.deepEqual(client.docs.get('boards/b/items/i/updates/u').data.likes, [OTHER, ME]);
  await assert.rejects(
    service.setUpdateLike({ boardId: 'v', itemId: 'i', updateId: 'u', liked: true }),
    /only view/,
  );
});

test('findMember matches workspace members by email only, never leaking others', async () => {
  const { service } = setup({
    extra: {
      [`workspaces/${WS}/members/${ME}`]: {
        displayName: 'Avery Quinn',
        email: 'avery@example.com',
      },
      [`workspaces/${WS}/members/${OTHER}`]: {
        displayName: 'Jordan Lee',
        email: 'Jordan.Lee@example.com',
      },
      'workspaces/other-ws/members/outsider': {
        displayName: 'Casey Fox',
        email: 'casey@example.com',
      },
    },
  });
  const hit = await service.findMember({ email: '  JORDAN.lee@Example.com ' });
  assert.deepEqual(hit, {
    workspaceId: WS,
    found: true,
    member: {
      uid: OTHER,
      name: 'Jordan Lee',
      email: 'Jordan.Lee@example.com',
      workspaceRole: 'member',
      me: false,
    },
  });
  assert.equal((await service.findMember({ email: 'avery@example.com' })).member.me, true);
  // An account that exists but is not in this workspace answers like an unknown address.
  const outsider = await service.findMember({ email: 'casey@example.com' });
  const unknown = await service.findMember({ email: 'nobody@example.com' });
  assert.deepEqual(outsider, { workspaceId: WS, found: false });
  assert.deepEqual(unknown, outsider);
  assert.deepEqual(
    await service.findMember({ email: 'jordan@example.com' }),
    outsider,
    'no partial match',
  );
  await assert.rejects(service.findMember({ email: 'jordan' }), /full email/);
  await assert.rejects(
    service.findMember({ email: 'a@b.co', workspaceId: 'other-ws' }),
    /not found among your workspaces/,
  );
});

test('tool catalogue: the batch 1a tools reach the service with the right scopes', async () => {
  const calls = [];
  const spy = new Proxy({}, { get: (_, key) => async (args) => calls.push([key, args]) });
  const tools = defineTools(spy);
  const byName = (n) => tools.find((t) => t.name === n);
  const scopes = {
    atrium_restore_item: 'write',
    atrium_move_item: 'write',
    atrium_reorder_groups: 'write',
    atrium_like_update: 'write',
    atrium_unlike_update: 'write',
    atrium_find_member: 'read',
  };
  for (const [name, scope] of Object.entries(scopes))
    assert.equal(byName(name)?.scope, scope, name);
  await byName('atrium_like_update').run({ boardId: 'b', itemId: 'i', updateId: 'u' });
  await byName('atrium_unlike_update').run({ boardId: 'b', itemId: 'i', updateId: 'u' });
  assert.deepEqual(
    calls.map(([key, args]) => [key, args.liked]),
    [
      ['setUpdateLike', true],
      ['setUpdateLike', false],
    ],
  );
  assert.equal(byName('atrium_move_item').inputSchema.position.safeParse('middle').success, false);
  assert.equal(byName('atrium_find_member').inputSchema.email.safeParse('a').success, false);
});

// ---- gap batch 1b: column management and item search ------------------------------------------

const colBoard = (access, more = {}) =>
  boardDoc(WS, access, {
    columns: [
      { id: 'c1', type: 'text', title: 'Note', position: 'a0', settings: {} },
      { id: 'c2', type: 'text', title: 'Extra', position: 'a1', settings: {} },
    ],
    ...more,
  });

const withRole = (role, more = {}, items = {}) =>
  setup({ extra: { 'boards/b': colBoard({ [ME]: role }, more), ...items } });

const columnTools = [
  ['renameColumn', { column: 'c1', title: 'Renamed' }],
  ['deleteColumn', { column: 'c1' }],
  ['reorderColumns', { columns: ['c2', 'c1'] }],
  ['setColumnLock', { column: 'c1', locked: true }],
  ['setColumnLock', { column: 'c1', locked: false }],
];

test('column tools: editors and viewers are refused, a stranger sees not found', async () => {
  for (const role of ['editor', 'viewer']) {
    const { service } = withRole(role);
    for (const [name, args] of columnTools) {
      await assert.rejects(service[name]({ boardId: 'b', ...args }), /board owner role/, name);
    }
  }
  const { service } = setup({ extra: { 'boards/b': colBoard({ [OTHER]: 'owner' }) } });
  for (const [name, args] of columnTools) {
    await assert.rejects(service[name]({ boardId: 'b', ...args }), /not found/, name);
  }
});

test('column tools: an unknown column is not found', async () => {
  const { service } = withRole('owner');
  await assert.rejects(service.renameColumn({ boardId: 'b', column: 'zz', title: 'X' }), /zz/);
  await assert.rejects(service.deleteColumn({ boardId: 'b', column: 'zz' }), /zz/);
  await assert.rejects(service.setColumnLock({ boardId: 'b', column: 'zz', locked: true }), /zz/);
  await assert.rejects(service.reorderColumns({ boardId: 'b', columns: ['c1', 'zz'] }), /zz/);
});

test('renameColumn renames, and refuses a title another column has', async () => {
  const { service, client } = withRole('owner');
  const result = await service.renameColumn({ boardId: 'b', column: 'Note', title: ' Remarks ' });
  assert.deepEqual(result, { id: 'c1', title: 'Remarks', was: 'Note' });
  assert.equal(client.docs.get('boards/b').data.columns[0].title, 'Remarks');
  await assert.rejects(
    service.renameColumn({ boardId: 'b', column: 'c1', title: 'extra' }),
    /already exists/,
  );
});

test('deleteColumn removes the column, its lock and its cell values', async () => {
  const { service, client } = withRole(
    'owner',
    { columnLocks: ['c1', 'c2'] },
    {
      'boards/b/items/i1': itemDoc({ values: { c1: { text: 'x' }, c2: { text: 'y' } } }),
      'boards/b/items/i2': itemDoc({ values: { c2: { text: 'z' } } }),
    },
  );
  const result = await service.deleteColumn({ boardId: 'b', column: 'Note' });
  assert.deepEqual(result, { deleted: 'c1', title: 'Note', valuesCleared: 1 });
  const board = client.docs.get('boards/b').data;
  assert.deepEqual(
    board.columns.map((c) => c.id),
    ['c2'],
  );
  assert.deepEqual(board.columnLocks, ['c2']);
  assert.deepEqual(client.docs.get('boards/b/items/i1').data.values, { c2: { text: 'y' } });
});

test('deleteColumn leaves the cells of a required column alone', async () => {
  const { service, client } = withRole(
    'owner',
    { requiredColumnIds: ['c1'] },
    { 'boards/b/items/i1': itemDoc({ values: { c1: { text: 'x' } } }) },
  );
  const result = await service.deleteColumn({ boardId: 'b', column: 'c1' });
  assert.equal(result.valuesCleared, 0);
  assert.ok(client.docs.get('boards/b/items/i1').data.values.c1);
});

test('reorderColumns rewrites positions and checks the list', async () => {
  const { service, client } = withRole('owner');
  const result = await service.reorderColumns({ boardId: 'b', columns: ['Extra', 'c1'] });
  assert.deepEqual(
    result.columns.map((c) => c.id),
    ['c2', 'c1'],
  );
  const cols = client.docs.get('boards/b').data.columns;
  assert.ok(cols.find((c) => c.id === 'c2').position < cols.find((c) => c.id === 'c1').position);
  await assert.rejects(service.reorderColumns({ boardId: 'b', columns: ['c1'] }), /missing/);
  await assert.rejects(
    service.reorderColumns({ boardId: 'b', columns: ['c1', 'c1'] }),
    /listed twice/,
  );
});

test('setColumnLock locks and unlocks, idempotently', async () => {
  const { service, client } = withRole('owner');
  const lock = (locked) => service.setColumnLock({ boardId: 'b', column: 'Note', locked });
  assert.deepEqual(await lock(true), { id: 'c1', title: 'Note', locked: true, changed: true });
  assert.equal((await lock(true)).changed, false);
  assert.deepEqual(client.docs.get('boards/b').data.columnLocks, ['c1']);
  assert.equal((await lock(false)).changed, true);
  assert.deepEqual(client.docs.get('boards/b').data.columnLocks, []);
  assert.equal((await lock(false)).changed, false);
});

const findFixture = () =>
  withRole(
    'viewer',
    {
      groups: [
        { id: 'g1', title: 'G', color: '#579bfc', position: 'a0' },
        { id: 'g2', title: 'H', color: '#579bfc', position: 'a1' },
      ],
    },
    {
      'boards/b/items/i1': itemDoc({
        name: 'Fix login',
        position: 'a0',
        values: { c1: 'urgent' },
      }),
      'boards/b/items/i2': itemDoc({ name: 'Login page', position: 'a1', groupId: 'g2' }),
      'boards/b/items/i3': itemDoc({ name: 'Other', position: 'a2' }),
      'boards/b/items/i4': itemDoc({ name: 'login gone', position: 'a3', state: 'deleted' }),
      'boards/b/items/s1': itemDoc({ name: 'login sub', parentItemId: 'i1' }),
    },
  );

test('findItems filters by name, group and column value, and pages', async () => {
  const { service } = findFixture(); // a viewer may read
  const byName = await service.findItems({ boardId: 'b', name: 'LOGIN' });
  assert.deepEqual(
    byName.items.map((i) => i.id),
    ['i1', 'i2'],
  );
  assert.equal(byName.total, 2);
  const inGroup = await service.findItems({ boardId: 'b', name: 'login', group: 'H' });
  assert.deepEqual(
    inGroup.items.map((i) => i.id),
    ['i2'],
  );
  const byValue = await service.findItems({
    boardId: 'b',
    where: [{ column: 'Note', equals: 'URGENT' }],
  });
  assert.deepEqual(
    byValue.items.map((i) => i.id),
    ['i1'],
  );
  assert.deepEqual(byValue.items[0].values, { Note: 'urgent' });
  const empty = await service.findItems({
    boardId: 'b',
    where: [{ column: 'Note', equals: null }],
  });
  assert.deepEqual(
    empty.items.map((i) => i.id),
    ['i3', 'i2'],
  );
  const first = await service.findItems({ boardId: 'b', limit: 2 });
  assert.equal(first.shown, 2);
  assert.equal(first.nextOffset, 2);
  const next = await service.findItems({ boardId: 'b', limit: 2, offset: first.nextOffset });
  assert.deepEqual(
    next.items.map((i) => i.id),
    ['i2'],
  );
  assert.equal(next.nextOffset, undefined);
});

test('findItems: a stranger sees not found, an unknown column or group is refused', async () => {
  const stranger = setup({ extra: { 'boards/b': colBoard({ [OTHER]: 'owner' }) } }).service;
  await assert.rejects(stranger.findItems({ boardId: 'b' }), /not found/);
  const { service } = findFixture();
  await assert.rejects(service.findItems({ boardId: 'b', group: 'nope' }), /nope/);
  await assert.rejects(
    service.findItems({ boardId: 'b', where: [{ column: 'nope', equals: 'x' }] }),
    /nope/,
  );
});

test('positionBetween raises a user error when two siblings share a position', async () => {
  const { positionBetween } = await import('./builders.mjs');
  assert.throws(
    () => positionBetween('a0', 'a0'),
    (e) => e.name === 'McpUserError' || e.constructor.name === 'McpUserError',
  );
  assert.throws(
    () => positionBetween('a0', 'a0'),
    /Two items share a position; reorder the group first\./,
  );
  assert.equal(typeof positionBetween('a0', 'a1'), 'string');
});

test('restoreItem leaves a subitem trashed earlier on its own in the trash', async () => {
  const { service, client } = setup({
    extra: {
      'boards/b': boardDoc(WS, { [ME]: 'editor' }),
      'boards/b/items/p': itemDoc({
        state: 'deleted',
        deletedAt: new Date('2026-11-01T10:00:00Z'),
      }),
      'boards/b/items/early': itemDoc({
        state: 'deleted',
        parentItemId: 'p',
        deletedAt: new Date('2026-10-01T10:00:00Z'),
      }),
      'boards/b/items/with': itemDoc({
        state: 'deleted',
        parentItemId: 'p',
        deletedAt: new Date('2026-11-01T10:00:00Z'),
      }),
    },
  });
  const result = await service.restoreItem({ boardId: 'b', itemId: 'p' });
  assert.equal(result.subitemsAlso, 1);
  assert.equal(client.docs.get('boards/b/items/with').data.state, 'active');
  assert.equal(client.docs.get('boards/b/items/early').data.state, 'deleted');
});

test('tool catalogue: the batch 1b tools reach the service with the right scopes', async () => {
  const calls = [];
  const spy = new Proxy({}, { get: (_, key) => async (args) => calls.push([key, args]) });
  const tools = defineTools(spy);
  const byName = (n) => tools.find((t) => t.name === n);
  const scopes = {
    atrium_rename_column: 'write',
    atrium_delete_column: 'write',
    atrium_reorder_columns: 'write',
    atrium_lock_column: 'write',
    atrium_unlock_column: 'write',
    atrium_find_items: 'read',
  };
  for (const [name, scope] of Object.entries(scopes))
    assert.equal(byName(name)?.scope, scope, name);
  await byName('atrium_lock_column').run({ boardId: 'b', column: 'c' });
  await byName('atrium_unlock_column').run({ boardId: 'b', column: 'c' });
  assert.deepEqual(
    calls.map(([key, args]) => [key, args.locked]),
    [
      ['setColumnLock', true],
      ['setColumnLock', false],
    ],
  );
  assert.equal(tools.length, CATALOGUE_SIZE);
});

test('findItems pages through equal positions and unknown groups without gaps or repeats', async () => {
  const items = {};
  for (const id of ['d', 'b', 'a', 'c', 'e']) {
    items[`boards/b/items/${id}`] = itemDoc({ name: `N ${id}`, position: 'a0' });
  }
  items['boards/b/items/z1'] = itemDoc({ name: 'N z1', groupId: 'gone', position: 'a0' });
  const { service } = withRole('viewer', {}, items);
  const seen = [];
  let offset = 0;
  for (;;) {
    const page = await service.findItems({ boardId: 'b', name: 'N', limit: 2, offset });
    seen.push(...page.items.map((i) => i.id));
    if (page.nextOffset === undefined) break;
    offset = page.nextOffset;
  }
  assert.deepEqual(seen, ['a', 'b', 'c', 'd', 'e', 'z1']);
});

test('findItems refuses to filter on a mirror or a server-managed column', async () => {
  const { service } = withRole('viewer', {
    columns: [
      { id: 'm1', type: 'mirror', title: 'Linked', position: 'a0', settings: {} },
      { id: 'f1', type: 'files', title: 'Docs', position: 'a1', settings: {} },
    ],
  });
  for (const column of ['Linked', 'Docs']) {
    await assert.rejects(
      service.findItems({ boardId: 'b', where: [{ column, equals: 1 }] }),
      /managed or mirror column, cannot filter/,
    );
  }
});

test('deleteColumn refuses a column that is changing type', async () => {
  const { service } = withRole('owner', {
    columns: [
      { id: 'c1', type: 'text', title: 'Note', position: 'a0', settings: {}, migrating: true },
    ],
  });
  await assert.rejects(service.deleteColumn({ boardId: 'b', column: 'c1' }), /changing type/);
});

test('deleteColumn reports a warning when the value cleanup fails after the board commit', async () => {
  const { service, client } = withRole(
    'owner',
    {},
    { 'boards/b/items/i1': itemDoc({ values: { c1: 'x' } }) },
  );
  const commit = client.commit.bind(client);
  client.commit = async (writes) => {
    if (writes.some((w) => w.path.includes('/items/'))) throw new Error('boom');
    return commit(writes);
  };
  const result = await service.deleteColumn({ boardId: 'b', column: 'c1' });
  assert.equal(result.valuesCleared, 0);
  assert.match(result.warning, /stopped after 0 of 1/);
  assert.deepEqual(
    client.docs.get('boards/b').data.columns.map((c) => c.id),
    ['c2'],
  );
});

test('restoreItem compares Timestamp-like deletedAt values', async () => {
  const stamp = (iso) => ({ toMillis: () => new Date(iso).getTime() });
  const { service, client } = setup({
    extra: {
      'boards/b': boardDoc(WS, { [ME]: 'editor' }),
      'boards/b/items/p': itemDoc({ state: 'deleted', deletedAt: stamp('2026-11-01T10:00:00Z') }),
      'boards/b/items/early': itemDoc({
        state: 'deleted',
        parentItemId: 'p',
        deletedAt: stamp('2026-10-01T10:00:00Z'),
      }),
      'boards/b/items/with': itemDoc({
        state: 'deleted',
        parentItemId: 'p',
        deletedAt: stamp('2026-11-01T10:00:00Z'),
      }),
    },
  });
  await service.restoreItem({ boardId: 'b', itemId: 'p' });
  assert.equal(client.docs.get('boards/b/items/with').data.state, 'active');
  assert.equal(client.docs.get('boards/b/items/early').data.state, 'deleted');
});

// ---- batch 1c, PR 1: votes, board lifecycle, people by email ---------------------------------------

const voteCol = (id = 'v1', title = 'Votes') => ({
  id,
  type: 'vote',
  title,
  position: 'a1',
  settings: {},
});
const voteBoard = (role = 'editor', more = {}) =>
  boardDoc(WS, { [ME]: role }, { columns: [voteCol()], ...more });

test('vote: adds the caller uid with a field-path write, repeats are no-ops, unvote removes it', async () => {
  const { service, client } = setup({
    extra: {
      'boards/b': voteBoard(),
      'boards/b/items/i': itemDoc({ values: { v1: { votersIds: [OTHER] } } }),
    },
  });
  const first = await service.setVote({ boardId: 'b', itemId: 'i', voted: true });
  assert.deepEqual(first, { itemId: 'i', column: 'Votes', votes: 2, voted: true, changed: true });
  assert.deepEqual(client.docs.get('boards/b/items/i').data.values.v1.votersIds, [OTHER, ME]);
  const last = client.commits.at(-1);
  assert.deepEqual(Object.keys(last[0].set).sort(), ['updatedAt', 'updatedBy', 'values.v1']);
  assert.equal(last[0].set.updatedBy, ME);
  const again = await service.setVote({ boardId: 'b', itemId: 'i', voted: true });
  assert.equal(again.changed, false);
  assert.equal(again.votes, 2);
  const removed = await service.setVote({ boardId: 'b', itemId: 'i', voted: false });
  assert.deepEqual(removed, {
    itemId: 'i',
    column: 'Votes',
    votes: 1,
    voted: false,
    changed: true,
  });
  const noop = await service.setVote({ boardId: 'b', itemId: 'i', voted: false });
  assert.equal(noop.changed, false);
  assert.deepEqual(client.docs.get('boards/b/items/i').data.values.v1.votersIds, [OTHER]);
});

test('vote: forbidden for a viewer, not found outside the memberships, missing item', async () => {
  const viewer = setup({
    extra: { 'boards/b': voteBoard('viewer'), 'boards/b/items/i': itemDoc() },
  });
  await assert.rejects(
    viewer.service.setVote({ boardId: 'b', itemId: 'i', voted: true }),
    /only view/,
  );
  const stranger = setup({
    extra: {
      'boards/b': boardDoc('other-ws', { [OTHER]: 'owner' }, { columns: [voteCol()] }),
      'boards/b/items/i': itemDoc(),
    },
  });
  await assert.rejects(
    stranger.service.setVote({ boardId: 'b', itemId: 'i', voted: true }),
    /not found in your workspaces/,
  );
  const { service } = setup({ extra: { 'boards/b': voteBoard() } });
  await assert.rejects(
    service.setVote({ boardId: 'b', itemId: 'nope', voted: true }),
    /not found on this board/,
  );
});

test('vote: infers the only vote column, asks when there are none or several, works on subitems', async () => {
  const none = setup({
    extra: { 'boards/b': boardDoc(WS, { [ME]: 'editor' }), 'boards/b/items/i': itemDoc() },
  });
  await assert.rejects(
    none.service.setVote({ boardId: 'b', itemId: 'i', voted: true }),
    /no vote column/,
  );
  const two = setup({
    extra: {
      'boards/b': boardDoc(
        WS,
        { [ME]: 'editor' },
        { columns: [voteCol('v1', 'Votes'), voteCol('v2', 'Priority votes')] },
      ),
      'boards/b/items/i': itemDoc(),
    },
  });
  await assert.rejects(
    two.service.setVote({ boardId: 'b', itemId: 'i', voted: true }),
    /several vote columns/,
  );
  const picked = await two.service.setVote({
    boardId: 'b',
    itemId: 'i',
    column: 'priority votes',
    voted: true,
  });
  assert.equal(picked.column, 'Priority votes');
  assert.deepEqual(two.client.docs.get('boards/b/items/i').data.values.v2, { votersIds: [ME] });
  await assert.rejects(
    two.service.setVote({ boardId: 'b', itemId: 'i', column: 'Note', voted: true }),
    /No column/,
  );
  const sub = setup({
    extra: {
      'boards/b': voteBoard(),
      'boards/b/items/p': itemDoc(),
      'boards/b/items/s': itemDoc({ parentItemId: 'p' }),
    },
  });
  const result = await sub.service.setVote({ boardId: 'b', itemId: 's', voted: true });
  assert.equal(result.votes, 1);
});

test('vote: a locked column refuses a non-owner and an owner may vote', async () => {
  const locked = setup({
    extra: {
      'boards/b': voteBoard('editor', { columnLocks: ['v1'] }),
      'boards/b/items/i': itemDoc(),
    },
  });
  await assert.rejects(
    locked.service.setVote({ boardId: 'b', itemId: 'i', voted: true }),
    /locked to board owners/,
  );
  const owner = setup({
    extra: {
      'boards/b': voteBoard('owner', { columnLocks: ['v1'] }),
      'boards/b/items/i': itemDoc(),
    },
  });
  assert.equal((await owner.service.setVote({ boardId: 'b', itemId: 'i', voted: true })).votes, 1);
});

test('vote: a raced write is retried once and then fails', async () => {
  const { service, client } = setup({
    extra: { 'boards/b': voteBoard(), 'boards/b/items/i': itemDoc() },
  });
  const real = client.commit.bind(client);
  let races = 1;
  client.commit = async (writes) => {
    if (races-- > 0) {
      await real([{ op: 'patch', path: 'boards/b/items/i', data: { name: 'Changed' } }]);
    }
    return real(writes);
  };
  assert.equal((await service.setVote({ boardId: 'b', itemId: 'i', voted: true })).votes, 1);
  races = 2;
  await assert.rejects(
    service
      .setVote({ boardId: 'b', itemId: 'i', voted: false })
      .then(() => service.setVote({ boardId: 'b', itemId: 'i', voted: true })),
    (e) => e.status === 409,
  );
});

test('update_item and create_items refuse raw vote values; the board shows the count', async () => {
  const { service } = setup({
    extra: {
      'boards/b': voteBoard(),
      'boards/b/items/i': itemDoc({ values: { v1: { votersIds: [OTHER, ME] } } }),
    },
  });
  const message = /Use atrium_vote_item or atrium_unvote_item for vote columns\./;
  await assert.rejects(
    service.updateItem({ boardId: 'b', itemId: 'i', values: { Votes: { votersIds: [ME] } } }),
    message,
  );
  await assert.rejects(
    service.updateItem({ boardId: 'b', itemId: 'i', values: { Votes: null } }),
    message,
  );
  await assert.rejects(
    service.createItems({ boardId: 'b', items: [{ name: 'X', values: { Votes: 3 } }] }),
    message,
  );
  const board = await service.getBoard({ boardId: 'b' });
  assert.equal(board.items[0].values.Votes, '2');
});

test('people cells take a member email, case-insensitively; others look like unknown uids', async () => {
  const { service, client } = setup({
    extra: {
      'boards/b': boardDoc(
        WS,
        { [ME]: 'editor' },
        { columns: [{ id: 'p1', type: 'people', title: 'Owner', position: 'a0', settings: {} }] },
      ),
      'boards/b/items/i': itemDoc(),
      [`workspaces/${WS}/members/${OTHER}`]: {
        displayName: 'Jordan Lee',
        email: 'Jordan@Example.com',
      },
      'workspaces/other-ws/members/user-outsider': { displayName: 'Sam', email: 'sam@example.com' },
    },
  });
  await service.updateItem({
    boardId: 'b',
    itemId: 'i',
    values: { Owner: ['  jordan@example.COM ', 'me'] },
  });
  assert.deepEqual(client.docs.get('boards/b/items/i').data.values.p1, {
    personsAndTeams: [
      { id: OTHER, kind: 'person' },
      { id: ME, kind: 'person' },
    ],
  });
  const errors = [];
  for (const input of ['sam@example.com', 'nobody@example.com', 'user-unknown']) {
    await service
      .updateItem({ boardId: 'b', itemId: 'i', values: { Owner: input } })
      .catch((e) => errors.push(e.message));
  }
  assert.equal(errors.length, 3);
  assert.equal(new Set(errors).size, 1);
  assert.match(errors[0], /uids, the email of a workspace member/);
});

const lifecycle = (state = 'active', role = 'owner', more = {}) =>
  boardDoc(WS, { [ME]: role }, { state, name: 'Plans', ...more });

test('renameBoard changes name and description as an editor and reports the previous values', async () => {
  const { service, client } = setup({ extra: { 'boards/b': lifecycle('active', 'editor') } });
  const result = await service.renameBoard({ boardId: 'b', name: '  Roadmap  ' });
  assert.deepEqual(result, {
    id: 'b',
    name: 'Roadmap',
    description: '',
    was: { name: 'Plans', description: '' },
  });
  await service.renameBoard({ boardId: 'b', description: 'Q4' });
  const stored = client.docs.get('boards/b').data;
  assert.equal(stored.name, 'Roadmap');
  assert.equal(stored.description, 'Q4');
  assert.equal(stored.updatedBy, ME);
  await assert.rejects(service.renameBoard({ boardId: 'b' }), /name or a description/);
  await assert.rejects(service.renameBoard({ boardId: 'b', name: '   ' }), /1 to 120/);
  await assert.rejects(service.renameBoard({ boardId: 'b', name: 'x'.repeat(121) }), /1 to 120/);
});

test('renameBoard: viewer forbidden, outsider and inactive boards refused', async () => {
  const viewer = setup({ extra: { 'boards/b': lifecycle('active', 'viewer') } });
  await assert.rejects(viewer.service.renameBoard({ boardId: 'b', name: 'X' }), /only view/);
  const out = setup({
    extra: { 'boards/b': boardDoc('other-ws', { [OTHER]: 'owner' }) },
  });
  await assert.rejects(out.service.renameBoard({ boardId: 'b', name: 'X' }), /not found/);
  const archived = setup({ extra: { 'boards/b': lifecycle('archived') } });
  await assert.rejects(archived.service.renameBoard({ boardId: 'b', name: 'X' }), /archived/);
});

test('archive, trash and restore a board move state and deletedAt like the web app', async () => {
  const { service, client } = setup({ extra: { 'boards/b': lifecycle() } });
  const state = () => client.docs.get('boards/b').data;
  assert.deepEqual(await service.setBoardState({ boardId: 'b', to: 'archived' }), {
    id: 'b',
    name: 'Plans',
    state: 'archived',
    was: 'active',
  });
  assert.equal(state().deletedAt, null);
  await assert.rejects(service.setBoardState({ boardId: 'b', to: 'archived' }), /already archived/);
  const trashed = await service.setBoardState({ boardId: 'b', to: 'deleted' });
  assert.equal(trashed.was, 'archived');
  assert.equal(state().state, 'deleted');
  assert.equal(+state().deletedAt, +NOW);
  assert.equal(state().updatedBy, ME);
  await assert.rejects(service.setBoardState({ boardId: 'b', to: 'deleted' }), /already deleted/);
  await assert.rejects(service.setBoardState({ boardId: 'b', to: 'archived' }), /only a board/);
  const back = await service.setBoardState({ boardId: 'b', to: 'active' });
  assert.equal(back.was, 'deleted');
  assert.equal(state().state, 'active');
  assert.equal(state().deletedAt, null);
  await assert.rejects(service.setBoardState({ boardId: 'b', to: 'active' }), /already active/);
});

test('board lifecycle needs the owner role; outsiders get not found', async () => {
  for (const to of ['archived', 'deleted']) {
    const editor = setup({ extra: { 'boards/b': lifecycle('active', 'editor') } });
    await assert.rejects(editor.service.setBoardState({ boardId: 'b', to }), /board owner role/);
  }
  const trashed = setup({ extra: { 'boards/b': lifecycle('deleted', 'editor') } });
  await assert.rejects(trashed.service.setBoardState({ boardId: 'b', to: 'active' }), /owner role/);
  const out = setup({ extra: { 'boards/b': boardDoc('other-ws', { [OTHER]: 'owner' }) } });
  await assert.rejects(out.service.setBoardState({ boardId: 'b', to: 'deleted' }), /not found/);
  const none = setup();
  await assert.rejects(none.service.setBoardState({ boardId: 'zz', to: 'deleted' }), /not found/);
});

test('restoring a board clears a folder that no longer exists and keeps one that does', async () => {
  const { service, client } = setup({
    extra: {
      'boards/gone': lifecycle('archived', 'owner', { folderId: 'f-gone' }),
      'boards/kept': lifecycle('deleted', 'owner', { folderId: 'f1' }),
      [`workspaces/${WS}/folders/f1`]: { name: 'Work' },
    },
  });
  await service.setBoardState({ boardId: 'gone', to: 'active' });
  await service.setBoardState({ boardId: 'kept', to: 'active' });
  assert.equal(client.docs.get('boards/gone').data.folderId, null);
  assert.equal(client.docs.get('boards/kept').data.folderId, 'f1');
});

test('inactive boards stay closed to the other tools; listBoards filters by state', async () => {
  const { service } = setup({
    extra: {
      'boards/a': lifecycle('active', 'owner', { name: 'Live', position: 'a0' }),
      'boards/r': lifecycle('archived', 'owner', { name: 'Old', position: 'a1' }),
      'boards/d': lifecycle('deleted', 'owner', { name: 'Gone', position: 'a2' }),
      'boards/x': boardDoc('other-ws', { [OTHER]: 'owner' }, { state: 'archived' }),
    },
  });
  const names = async (state) => (await service.listBoards({ state })).boards.map((b) => b.name);
  assert.deepEqual(await names(undefined), ['Live']);
  assert.deepEqual(await names('archived'), ['Old']);
  assert.deepEqual(await names('deleted'), ['Gone']);
  await assert.rejects(service.addGroup({ boardId: 'r', title: 'X' }), /archived, not active/);
  await assert.rejects(service.getBoard({ boardId: 'd' }), /deleted, not active/);
});

test('tool catalogue: batch 1c PR 1 tools, scopes, annotations and schemas', async () => {
  const calls = [];
  const spy = new Proxy({}, { get: (_, key) => async (args) => calls.push([key, args]) });
  const tools = defineTools(spy);
  const byName = (n) => tools.find((t) => t.name === n);
  const scopes = {
    atrium_vote_item: 'write',
    atrium_unvote_item: 'write',
    atrium_rename_board: 'write',
    atrium_archive_board: 'write',
    atrium_delete_board: 'write',
    atrium_restore_board: 'write',
  };
  for (const [name, scope] of Object.entries(scopes))
    assert.equal(byName(name)?.scope, scope, name);
  assert.equal(byName('atrium_delete_board').annotations.destructiveHint, true);
  assert.equal(byName('atrium_archive_board').annotations.destructiveHint, false);
  await byName('atrium_vote_item').run({ boardId: 'b', itemId: 'i' });
  await byName('atrium_unvote_item').run({ boardId: 'b', itemId: 'i' });
  await byName('atrium_archive_board').run({ boardId: 'b' });
  await byName('atrium_delete_board').run({ boardId: 'b' });
  await byName('atrium_restore_board').run({ boardId: 'b' });
  assert.deepEqual(
    calls.map(([key, args]) => [key, args.voted ?? args.to]),
    [
      ['setVote', true],
      ['setVote', false],
      ['setBoardState', 'archived'],
      ['setBoardState', 'deleted'],
      ['setBoardState', 'active'],
    ],
  );
  assert.equal(byName('atrium_list_boards').inputSchema.state.safeParse('trash').success, false);
  assert.equal(byName('atrium_rename_board').inputSchema.name.safeParse('').success, false);
  assert.equal(tools.length, CATALOGUE_SIZE);
});

// ---- templates (batch 1c PR 2) ----------------------------------------------------------------

test('tool catalogue: batch 1c PR 2 tools reach the service', async () => {
  const calls = [];
  const spy = new Proxy({}, { get: (_, key) => async (args) => calls.push([key, args]) });
  const tools = defineTools(spy);
  const byName = (n) => tools.find((t) => t.name === n);
  assert.equal(byName('atrium_list_templates').scope, 'read');
  assert.equal(byName('atrium_create_board').scope, 'write');
  assert.equal(byName('atrium_create_board').annotations.destructiveHint, false);
  await byName('atrium_list_templates').run({ workspaceId: 'w' });
  await byName('atrium_create_board').run({ name: 'B', templateId: 'bug-tracker' });
  assert.deepEqual(calls[0], ['listTemplates', { workspaceId: 'w' }]);
  assert.equal(calls[1][1].templateId, 'bug-tracker');
  assert.equal(
    byName('atrium_create_board').inputSchema.templateId.safeParse('a/b').success,
    false,
  );
  assert.equal(tools.length, CATALOGUE_SIZE);
});

const savedTemplate = (more = {}) => ({
  name: 'Our plan',
  description: 'Saved',
  structure: {
    columns: [
      {
        id: 'c1',
        type: 'text',
        title: 'Note',
        position: 'a0',
        settings: {},
        migrating: { snapshotId: 's1', startedAt: 1, kind: 'change' },
      },
      { id: 'c2', type: 'vote', title: 'Votes', position: 'a1', settings: {} },
    ],
    subitemColumns: [],
    groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
    itemTerminology: 'Item',
  },
  sampleItems: [
    { name: 'One', groupId: 'g1', values: { c1: 'hello', c2: { votersIds: ['x'] }, gone: 'x' } },
    { name: 'Two', groupId: 'g1', values: {} },
  ],
  itemCount: 2,
  ...more,
});
const withTemplate = (roles) =>
  setup({ roles, extra: { [`workspaces/${WS}/templates/t1`]: savedTemplate() } });

test('listTemplates lists the built-ins, then the saved templates', async () => {
  const { service } = withTemplate();
  const { workspaceId, templates } = await service.listTemplates();
  assert.equal(workspaceId, WS);
  const builtIns = templates.filter((t) => t.source === 'built-in');
  assert.ok(builtIns.length >= 3);
  assert.deepEqual(
    templates.slice(0, builtIns.length).map((t) => t.source),
    builtIns.map(() => 'built-in'),
  );
  const saved = templates.at(-1);
  assert.deepEqual(saved, {
    id: 't1',
    source: 'workspace',
    name: 'Our plan',
    description: 'Saved',
    columns: [
      { title: 'Note', type: 'text' },
      { title: 'Votes', type: 'vote' },
    ],
    groups: ['Todo'],
    sampleItems: 2,
  });
});

test('listTemplates: a viewer may list, a non-member and an unknown workspace are refused', async () => {
  const viewer = withTemplate({ [ME]: 'viewer' });
  assert.ok((await viewer.service.listTemplates()).templates.length > 0);
  const outsider = withTemplate({ [OTHER]: 'owner' });
  await assert.rejects(outsider.service.listTemplates(), /not a member|not found/);
  await assert.rejects(outsider.service.listTemplates({ workspaceId: WS }), /not found/);
});

test('createBoard from every built-in template is valid, with empty server id lists', async () => {
  const { templates } = await setup().service.listTemplates();
  for (const t of templates.filter((x) => x.source === 'built-in')) {
    const { client, service } = setup();
    const created = await service.createBoard({ name: t.name, templateId: t.id });
    const board = client.docs.get(`boards/${created.id}`).data;
    assert.equal(
      boardSchema.safeParse({
        ...board,
        createdAt: ts(board.createdAt),
        updatedAt: ts(board.updatedAt),
      }).success,
      true,
      t.id,
    );
    assert.deepEqual(board.derivedColumnIds, [], t.id);
    assert.deepEqual(board.serverManagedColumnIds, [], t.id);
    assert.deepEqual(board.requiredColumnIds, [], t.id);
    assert.equal('voteColumnIds' in board, false, t.id);
    assert.deepEqual(board.subitemColumns, [], t.id);
    assert.equal(created.sampleItems, t.sampleItems, t.id);
    const groupIds = new Set(board.groups.map((g) => g.id));
    const items = [...client.docs.entries()].filter(([p]) =>
      p.startsWith(`boards/${created.id}/items/`),
    );
    assert.equal(items.length, t.sampleItems, t.id);
    for (const [, { data }] of items) {
      const stamped = { ...data, createdAt: ts(data.createdAt), updatedAt: ts(data.updatedAt) };
      const parsed = itemSchema.safeParse(stamped);
      assert.equal(parsed.success, true, `${t.id} ${JSON.stringify(parsed.error?.issues)}`);
      assert.ok(groupIds.has(data.groupId), t.id);
      assert.equal(data.createdBy, ME);
    }
  }
});

test('createBoard from a template: sample items off, positions per group, derived values skipped', async () => {
  const { client, service } = setup();
  const off = await service.createBoard({
    name: 'Off',
    templateId: 'bug-tracker',
    includeSampleItems: false,
  });
  assert.equal(off.sampleItems, 0);
  assert.equal(
    [...client.docs.keys()].filter((p) => p.startsWith(`boards/${off.id}/items/`)).length,
    0,
  );
  const on = await service.createBoard({ name: 'On', templateId: 'bug-tracker' });
  const board = client.docs.get(`boards/${on.id}`).data;
  const derived = new Set(
    board.columns.filter((c) => columnRegistry.isDerived(c.type)).map((c) => c.id),
  );
  const items = [...client.docs.entries()]
    .filter(([p]) => p.startsWith(`boards/${on.id}/items/`))
    .map(([, v]) => v.data);
  for (const item of items) {
    for (const key of Object.keys(item.values)) assert.equal(derived.has(key), false);
  }
  const byGroup = new Map();
  for (const item of items)
    byGroup.set(item.groupId, [...(byGroup.get(item.groupId) ?? []), item.position]);
  for (const positions of byGroup.values()) {
    assert.equal(new Set(positions).size, positions.length);
  }
});

test('createBoard from a saved template strips server fields and vote values', async () => {
  const { client, service } = withTemplate();
  const created = await service.createBoard({ name: 'Mine', templateId: 't1' });
  assert.deepEqual(created.template, { id: 't1', source: 'workspace', name: 'Our plan' });
  assert.equal(created.sampleItems, 2);
  const board = client.docs.get(`boards/${created.id}`).data;
  assert.equal('migrating' in board.columns[0], false);
  assert.deepEqual(
    board.columns.map((c) => c.id),
    ['c1', 'c2'],
  );
  assert.equal(board.name, 'Mine');
  assert.deepEqual(board.access, { [ME]: 'owner' });
  const items = [...client.docs.entries()]
    .filter(([p]) => p.startsWith(`boards/${created.id}/items/`))
    .map(([, v]) => v.data)
    .sort((a, b) => (a.position < b.position ? -1 : 1));
  assert.deepEqual(
    items.map((i) => i.name),
    ['One', 'Two'],
  );
  assert.deepEqual(items[0].values, { c1: 'hello' });
  const none = await service.createBoard({
    name: 'Bare',
    templateId: 't1',
    includeSampleItems: false,
  });
  assert.equal(none.sampleItems, 0);
});

test('createBoard with templateId: unknown id, bad id, stray includeSampleItems, role and sample-item failure', async () => {
  const { service } = withTemplate();
  await assert.rejects(service.createBoard({ name: 'X', templateId: 'nope' }), /was not found/);
  await assert.rejects(service.createBoard({ name: 'X', templateId: 'a/b' }), /plain id/);
  await assert.rejects(
    service.createBoard({ name: 'X', includeSampleItems: false }),
    /only applies together with templateId/,
  );
  const viewer = withTemplate({ [ME]: 'viewer' });
  await assert.rejects(
    viewer.service.createBoard({ name: 'X', templateId: 't1' }),
    /member role or higher/,
  );
  // A damaged saved template is refused before anything is written.
  const bad = setup({
    extra: { [`workspaces/${WS}/templates/bad`]: { name: 'Bad', structure: { columns: 1 } } },
  });
  await assert.rejects(bad.service.createBoard({ name: 'X', templateId: 'bad' }), /damaged/);
  assert.equal([...bad.client.docs.keys()].filter((p) => p.startsWith('boards/')).length, 0);
  // A failing second commit keeps the board and says so.
  const flaky = withTemplate();
  const realError = console.error;
  console.error = () => {};
  const commit = flaky.client.commit.bind(flaky.client);
  let n = 0;
  flaky.client.commit = async (w) => (++n === 2 ? Promise.reject(new Error('boom')) : commit(w));
  const created = await flaky.service.createBoard({ name: 'Flaky', templateId: 't1' });
  assert.equal(created.sampleItems, 0);
  console.error = realError;
  assert.match(created.warning, /sample items could not be added/);
});

test('listTemplates skips a damaged saved template instead of failing', async () => {
  const { service } = setup({
    extra: {
      [`workspaces/${WS}/templates/bad`]: { name: 'Bad', structure: { columns: 5, groups: 1 } },
      [`workspaces/${WS}/templates/t1`]: savedTemplate(),
    },
  });
  const { templates } = await service.listTemplates();
  assert.equal(
    templates.some((t) => t.id === 'bad'),
    false,
  );
  assert.equal(templates.at(-1).id, 't1');
});

test('built-in templates keep their storable sample values', async () => {
  const { templates } = await setup().service.listTemplates();
  const skipped = new Set(['people', 'vote', 'dependency']);
  for (const t of templates.filter((x) => x.source === 'built-in' && x.sampleItems > 0)) {
    const { client, service } = setup();
    const created = await service.createBoard({ name: t.name, templateId: t.id });
    const built = builtInTemplate(t.id);
    const types = new Map(built.structure.columns.map((c) => [c.id, c.type]));
    let expected = 0;
    for (const item of built.sampleItems) {
      for (const [col, v] of Object.entries(item.values)) {
        const type = types.get(col);
        if (v == null || !type || skipped.has(type)) continue;
        if (columnRegistry.isDerived(type) || columnRegistry.isServerManaged(type)) continue;
        expected += 1;
      }
    }
    let stored = 0;
    for (const [p, v] of client.docs)
      if (p.startsWith(`boards/${created.id}/items/`)) stored += Object.keys(v.data.values).length;
    assert.equal(stored, expected, `${t.id} dropped sample values`);
  }
});

// ---- move an item to another board (batch 1c PR 3) --------------------------------------------

const moveSetup = ({
  roles,
  srcAccess,
  dstAccess,
  dstMore = {},
  srcMore = {},
  extra = {},
} = {}) => {
  const src = boardDoc(WS, srcAccess ?? { [ME]: 'owner' }, {
    name: 'Src',
    columns: [
      { id: 't1', type: 'text', title: 'Note', position: 'a0', settings: {} },
      {
        id: 's1',
        type: 'status',
        title: 'Stage',
        position: 'a1',
        settings: {
          labels: [
            { index: 0, label: 'Todo', color: 'red' },
            { index: 1, label: 'Done', color: 'green' },
          ],
        },
      },
      { id: 'n1', type: 'numbers', title: 'Cost', position: 'a2', settings: {} },
      { id: 'f1', type: 'files', title: 'Docs', position: 'a3', settings: {} },
    ],
    ...srcMore,
  });
  const dst = boardDoc(WS, dstAccess ?? { [ME]: 'owner' }, {
    name: 'Dst',
    groups: [
      { id: 'gz', title: 'Zed', color: '#579bfc', position: 'a1' },
      { id: 'ga', title: 'Alpha', color: '#579bfc', position: 'a0' },
    ],
    columns: [
      { id: 't9', type: 'text', title: 'note', position: 'a0', settings: {} },
      {
        id: 's1',
        type: 'status',
        title: 'Other',
        position: 'a1',
        settings: { labels: [{ index: 0, label: 'Todo', color: 'red' }] },
      },
    ],
    ...dstMore,
  });
  return setup({
    roles,
    extra: {
      'boards/src': src,
      'boards/dst': dst,
      'boards/src/items/i1': {
        name: 'Travels',
        groupId: 'g1',
        position: 'a0',
        parentItemId: null,
        values: { t1: 'hi', s1: { index: 0 }, n1: 5 },
        state: 'active',
        deletedAt: null,
        createdAt: NOW,
        createdBy: ME,
        updatedAt: NOW,
        updatedBy: ME,
      },
      ...extra,
    },
  });
};

test('moveItemToBoard maps by id or title, copies and retires in one commit', async () => {
  const { service, client } = moveSetup();
  const dry = await service.moveItemToBoard({
    boardId: 'src',
    itemId: 'i1',
    targetBoardId: 'dst',
    dryRun: true,
  });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.newItemId, null);
  assert.equal(client.commits.length, 0);
  assert.equal(dry.group, 'Alpha');
  assert.deepEqual(dry.copied, [
    { from: 'Note', to: 'note' },
    { from: 'Stage', to: 'Other' },
  ]);
  assert.deepEqual(dry.dropped, [{ column: 'Cost', reason: 'no matching column' }]);
  await assert.rejects(
    service.moveItemToBoard({ boardId: 'src', itemId: 'i1', targetBoardId: 'dst' }),
    /Not copied: Cost \(no matching column\)/,
  );
  assert.equal(client.commits.length, 0);
  const moved = await service.moveItemToBoard({
    boardId: 'src',
    itemId: 'i1',
    targetBoardId: 'dst',
    allowDataLoss: true,
  });
  assert.equal(client.commits.length, 1);
  const copy = client.docs.get(`boards/dst/items/${moved.newItemId}`).data;
  assert.equal(copy.name, 'Travels');
  assert.equal(copy.groupId, 'ga');
  assert.deepEqual(copy.values, { t9: 'hi', s1: { index: 0 } });
  assert.equal(copy.createdBy, ME);
  assert.equal(client.docs.get('boards/src/items/i1').data.state, 'deleted');
});

test('moveItemToBoard maps labels by text, drops missing ones and never creates labels', async () => {
  const { service } = moveSetup();
  await service.updateItem({ boardId: 'src', itemId: 'i1', values: { Stage: 'Done' } });
  const dry = await service.moveItemToBoard({
    boardId: 'src',
    itemId: 'i1',
    targetBoardId: 'dst',
    dryRun: true,
  });
  assert.ok(
    dry.dropped.some((d) => d.column === 'Stage' && d.reason === 'label "Done" not on the target'),
  );
  assert.equal(dry.needsAllowDataLoss, true);
});

test('moveItemToBoard drops server-managed, dependency, locked and derived cells, and the description', async () => {
  const { service, client } = moveSetup({
    dstAccess: { [ME]: 'editor' },
    dstMore: {
      columnLocks: ['t9'],
    },
  });
  const item = client.docs.get('boards/src/items/i1');
  item.data.values.f1 = { files: [{ id: 'a' }, { id: 'b' }] };
  item.data.description = { type: 'doc', content: [] };
  const dry = await service.moveItemToBoard({
    boardId: 'src',
    itemId: 'i1',
    targetBoardId: 'dst',
    dryRun: true,
  });
  const reasons = Object.fromEntries(dry.dropped.map((d) => [d.column, d.reason]));
  assert.equal(reasons.Docs, 'cannot be copied yet');
  assert.match(reasons.Note, /locked/);
  assert.equal(reasons.description, 'not copied');
  await assert.rejects(
    service.moveItemToBoard({ boardId: 'src', itemId: 'i1', targetBoardId: 'dst' }),
    /Files on the item: 2/,
  );
});

test('moveItemToBoard counts updates, takes subitems along and places the item last', async () => {
  const sub = (name, position) => ({
    name,
    groupId: 'g1',
    position,
    parentItemId: 'i1',
    values: { t1: name },
    state: 'active',
    deletedAt: null,
    createdAt: NOW,
    createdBy: ME,
    updatedAt: NOW,
    updatedBy: ME,
  });
  const { service, client } = moveSetup({
    extra: {
      'boards/src/items/s1': sub('One', 'a0'),
      'boards/src/items/s2': sub('Two', 'a1'),
      'boards/src/items/i1/updates/u1': { content: 'hi' },
      'boards/dst/items/x': {
        name: 'Existing',
        groupId: 'gz',
        position: 'a5',
        parentItemId: null,
        values: {},
        state: 'active',
        deletedAt: null,
        createdAt: NOW,
        createdBy: ME,
        updatedAt: NOW,
        updatedBy: ME,
      },
    },
  });
  const dry = await service.moveItemToBoard({
    boardId: 'src',
    itemId: 'i1',
    targetBoardId: 'dst',
    group: 'zed',
    dryRun: true,
  });
  assert.equal(dry.subitems, 2);
  assert.equal(dry.updatesLeftOnSource, 1);
  const moved = await service.moveItemToBoard({
    boardId: 'src',
    itemId: 'i1',
    targetBoardId: 'dst',
    group: 'gz',
    allowDataLoss: true,
  });
  const copy = client.docs.get(`boards/dst/items/${moved.newItemId}`).data;
  assert.ok(copy.position > 'a5');
  const kids = [...client.docs.entries()].filter(
    ([path, v]) => path.startsWith('boards/dst/items/') && v.data.parentItemId === moved.newItemId,
  );
  assert.deepEqual(kids.map(([, v]) => v.data.name).sort(), ['One', 'Two']);
  assert.equal(client.docs.get('boards/src/items/s1').data.state, 'deleted');
  assert.equal(client.docs.get('boards/src/items/s2').data.state, 'deleted');
  assert.equal(client.commits.at(-1).length, 6);
});

test('moveItemToBoard refuses subitems, the same board, other workspaces, viewers and too many subitems', async () => {
  const sub = {
    name: 'One',
    groupId: 'g1',
    position: 'a0',
    parentItemId: 'i1',
    values: {},
    state: 'active',
    deletedAt: null,
    createdAt: NOW,
    createdBy: ME,
    updatedAt: NOW,
    updatedBy: ME,
  };
  const { service } = moveSetup({ extra: { 'boards/src/items/s1': sub } });
  const args = { boardId: 'src', itemId: 'i1', targetBoardId: 'dst' };
  await assert.rejects(service.moveItemToBoard({ ...args, itemId: 's1' }), /Move its parent/);
  await assert.rejects(
    service.moveItemToBoard({ ...args, targetBoardId: 'src' }),
    /different board/,
  );
  await assert.rejects(service.moveItemToBoard({ ...args, group: 'nope' }), /No group/);
  await assert.rejects(service.moveItemToBoard({ ...args, itemId: 'zz' }), /not found/);

  const other = moveSetup({
    roles: { [ME]: 'owner' },
    extra: {
      'workspaces/ws2': workspaceDoc({ [ME]: 'owner' }),
      'boards/far': boardDoc('ws2', { [ME]: 'owner' }),
    },
  });
  await assert.rejects(
    other.service.moveItemToBoard({ ...args, targetBoardId: 'far' }),
    /another workspace/,
  );

  const viewer = moveSetup({ dstAccess: { [ME]: 'viewer' } });
  await assert.rejects(
    viewer.service.moveItemToBoard(args),
    /Board "dst" was not found in your workspaces/,
  );
  const none = moveSetup({ dstAccess: { [OTHER]: 'owner' } });
  await assert.rejects(none.service.moveItemToBoard(args), /not found/);
  const srcViewer = moveSetup({ srcAccess: { [ME]: 'viewer' } });
  await assert.rejects(srcViewer.service.moveItemToBoard(args), /only view/);

  const extra = {};
  for (let i = 0; i < 201; i += 1) extra[`boards/src/items/k${i}`] = { ...sub };
  const big = moveSetup({ extra });
  await assert.rejects(big.service.moveItemToBoard(args), /201 subitems/);
});

test('tool catalogue: atrium_move_item_to_board is a destructive write that reaches the service', async () => {
  const calls = [];
  const spy = new Proxy({}, { get: (_, key) => async (args) => calls.push([key, args]) });
  const tools = defineTools(spy);
  const tool = tools.find((t) => t.name === 'atrium_move_item_to_board');
  assert.equal(tool.scope, 'write');
  assert.equal(tool.annotations.destructiveHint, true);
  await tool.run({ boardId: 'a', itemId: 'b', targetBoardId: 'c', dryRun: true });
  assert.deepEqual(calls[0], [
    'moveItemToBoard',
    { boardId: 'a', itemId: 'b', targetBoardId: 'c', dryRun: true },
  ]);
  assert.equal(tool.inputSchema.targetBoardId.safeParse('a/b').success, false);
  assert.equal(tools.length, CATALOGUE_SIZE);
});
