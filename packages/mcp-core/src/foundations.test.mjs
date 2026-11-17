// Batch 2 PR 1: calculated columns in reads, teams in People cells, members read from member docs,
// the list_teams tool and the client queries later PRs build on. In-memory Firestore only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';
import { readableCell } from './values.mjs';

const WS = 'ws1';
const ME = 'user-me';
const JORDAN = 'user-jordan';
const SAM = 'user-sam';
const OUTSIDER = 'user-outsider';
const NOW = new Date('2026-11-01T10:00:00Z');
const UPDATED = new Date('2026-10-30T08:15:00Z');

const label = (index, text, isDone = false) => ({
  id: `l${index}`,
  index,
  label: text,
  color: '#579bfc',
  isDone,
});

const COLUMNS = [
  { id: 'price', type: 'numbers', title: 'Price', position: 'a0', settings: {} },
  {
    id: 'calc',
    type: 'formula',
    title: 'Double',
    position: 'a1',
    settings: { expression: '{Price} * 2', outputType: 'number' },
  },
  {
    id: 'st',
    type: 'status',
    title: 'Stage',
    position: 'a2',
    settings: { labels: [label(0, 'Open'), label(1, 'Done', true)] },
  },
  {
    id: 'prog',
    type: 'progress',
    title: 'Progress',
    position: 'a3',
    settings: {
      related_columns: {
        isNormalized: true,
        columns: { st: { isSelected: true, percentage: 100 } },
      },
    },
  },
  { id: 'iid', type: 'item_id', title: 'ID', position: 'a4', settings: {} },
  {
    id: 'upd',
    type: 'last_updated',
    title: 'Touched',
    position: 'a5',
    settings: { mode: 'dateOnly' },
  },
  { id: 'who', type: 'people', title: 'Owner', position: 'a6', settings: {} },
  { id: 'one', type: 'people', title: 'Lead', position: 'a7', settings: { singlePerson: true } },
  { id: 'mir', type: 'mirror', title: 'Linked', position: 'a8', settings: {} },
];

const board = (more = {}) => ({
  workspaceId: WS,
  state: 'active',
  kind: 'private',
  access: { [ME]: 'owner' },
  accessUids: [ME],
  position: 'a0',
  folderId: null,
  name: 'Budget',
  description: '',
  columns: COLUMNS,
  subitemColumns: [],
  groups: [{ id: 'g1', title: 'G', color: '#579bfc', position: 'a0' }],
  ...more,
});

const item = (more = {}) => ({
  name: 'Task',
  groupId: 'g1',
  position: 'a0',
  parentItemId: null,
  state: 'active',
  values: {},
  seq: 7,
  boardSeq: 3,
  createdAt: UPDATED,
  createdBy: ME,
  updatedAt: UPDATED,
  updatedBy: JORDAN,
  ...more,
});

const memberDoc = (displayName, email, more = {}) => ({ displayName, email, ...more });

function setup({ boardMore, extra = {} } = {}) {
  const client = createFakeClient({
    [`workspaces/${WS}`]: {
      name: 'Home',
      ownerId: ME,
      roles: { [ME]: 'owner', [JORDAN]: 'member', [SAM]: 'member' },
      memberIds: [ME, JORDAN, SAM],
    },
    [`users/${ME}`]: { displayName: 'Avery Quinn', photoURL: null },
    [`workspaces/${WS}/members/${ME}`]: memberDoc('Avery Quinn', 'avery@example.com'),
    [`workspaces/${WS}/members/${JORDAN}`]: memberDoc('Jordan Lee', 'jordan@example.com', {
      profile: {
        title: 'Cook',
        about: 'private',
        location: 'Lyon',
        birthday: null,
        timeZone: null,
      },
    }),
    [`workspaces/${WS}/members/${SAM}`]: memberDoc('Sam Reed', 'sam@example.com', {
      profile: {
        title: null,
        about: null,
        location: null,
        birthday: null,
        timeZone: 'Europe/Paris',
      },
    }),
    [`workspaces/${WS}/teams/t-kids`]: {
      name: 'Kids',
      color: '#579bfc',
      memberUids: [SAM, OUTSIDER],
    },
    [`workspaces/${WS}/teams/t-cooks`]: { name: 'Cooks', color: '#ff642e', memberUids: [JORDAN] },
    'boards/b': board(boardMore),
    'boards/b/items/i1': item({
      name: 'Pizza',
      values: { price: { value: 10 }, st: { index: 1 } },
    }),
    'boards/b/items/i2': item({
      name: 'Pasta',
      position: 'a1',
      seq: 8,
      boardSeq: 4,
      values: { price: { value: 4 } },
    }),
    ...extra,
  });
  const service = createService({ client, actor: { uid: ME }, now: () => NOW });
  return { client, service };
}

const byName = (result) => Object.fromEntries(result.items.map((i) => [i.name, i]));

// ---- calculated columns -----------------------------------------------------------------------

test('get_board shows formula, progress, item ID and last updated values; mirror stays empty', async () => {
  const { service } = setup();
  const { items } = await service.getBoard({ boardId: 'b' });
  const pizza = byName({ items }).Pizza.values;
  assert.equal(pizza.Double, '20');
  assert.equal(pizza.Progress, '100%');
  assert.equal(pizza.ID, '7');
  assert.equal(pizza.Touched, '2026-10-30T08:15:00.000Z');
  assert.equal('Linked' in pizza, false);
  const pasta = byName({ items }).Pasta.values;
  assert.equal(pasta.Double, '8');
  assert.equal(pasta.Progress, '0%');
});

test('find_items matches the computed text of a calculated column', async () => {
  const { service } = setup();
  const found = await service.findItems({
    boardId: 'b',
    where: [{ column: 'Double', equals: '20' }],
  });
  assert.deepEqual(
    found.items.map((i) => i.name),
    ['Pizza'],
  );
  assert.equal(found.items[0].values.Double, '20');
  const byId = await service.findItems({ boardId: 'b', where: [{ column: 'ID', equals: '8' }] });
  assert.deepEqual(
    byId.items.map((i) => i.name),
    ['Pasta'],
  );
});

test('list_subitems computes calculated columns for subitems too', async () => {
  const { service } = setup({
    extra: {
      'boards/b/items/s1': item({
        name: 'Sub',
        parentItemId: 'i1',
        seq: 9,
        values: { price: { value: 3 } },
      }),
    },
  });
  const { subitems } = await service.listSubitems({ boardId: 'b', itemId: 'i1' });
  assert.equal(subitems[0].values.Double, '6');
  assert.equal(subitems[0].values.ID, '9');
});

test('readableCell without an item context gives null for a calculated column', () => {
  assert.equal(readableCell(COLUMNS[1], undefined), null);
  assert.equal(readableCell(COLUMNS[1], undefined, { columns: COLUMNS }), null);
});

// ---- teams in People cells ----------------------------------------------------------------------

const stored = (client, id = 'i1', column = 'who') =>
  client.docs.get(`boards/b/items/${id}`).data.values[column];

test('a team is assigned by name, id, "team:" text or { team }, with people mixed in', async () => {
  const { service, client } = setup();
  await service.updateItem({ boardId: 'b', itemId: 'i1', values: { Owner: ['team:kids', 'me'] } });
  assert.deepEqual(stored(client), {
    personsAndTeams: [
      { id: 't-kids', kind: 'team' },
      { id: ME, kind: 'person' },
    ],
  });
  await service.updateItem({ boardId: 'b', itemId: 'i1', values: { Owner: 'team:t-cooks' } });
  assert.deepEqual(stored(client), { personsAndTeams: [{ id: 't-cooks', kind: 'team' }] });
  await service.updateItem({ boardId: 'b', itemId: 'i1', values: { Owner: { team: ' COOKS ' } } });
  assert.deepEqual(stored(client), { personsAndTeams: [{ id: 't-cooks', kind: 'team' }] });
  await service.updateItem({
    boardId: 'b',
    itemId: 'i1',
    values: { Owner: [{ team: 'Kids' }, JORDAN, 'sam@example.com'] },
  });
  assert.deepEqual(stored(client), {
    personsAndTeams: [
      { id: 't-kids', kind: 'team' },
      { id: JORDAN, kind: 'person' },
      { id: SAM, kind: 'person' },
    ],
  });
  // The native stored shape still passes through, so existing callers keep working.
  await service.updateItem({
    boardId: 'b',
    itemId: 'i1',
    values: { Owner: { personsAndTeams: [{ id: 't-kids', kind: 'team' }] } },
  });
  assert.deepEqual(stored(client), { personsAndTeams: [{ id: 't-kids', kind: 'team' }] });
});

test('an unknown team lists the team names; an empty reference and a duplicate name are refused', async () => {
  const { service } = setup({
    extra: { [`workspaces/${WS}/teams/t-dup`]: { name: 'kids', color: '#000000', memberUids: [] } },
  });
  await assert.rejects(
    service.updateItem({ boardId: 'b', itemId: 'i1', values: { Owner: 'team:Grown-ups' } }),
    /No team "Grown-ups" in this workspace\. Teams: "Cooks", "Kids", "kids"\./,
  );
  await assert.rejects(
    service.updateItem({ boardId: 'b', itemId: 'i1', values: { Owner: 'team:' } }),
    /Give the team as a name or an id/,
  );
  await assert.rejects(
    service.updateItem({ boardId: 'b', itemId: 'i1', values: { Owner: 'team:KIDS' } }),
    /More than one team is called "KIDS" \(ids: .*t-dup.*\)/,
  );
  // The id still works when names clash.
  await service.updateItem({ boardId: 'b', itemId: 'i1', values: { Owner: 'team:t-kids' } });
});

test('a single-person column takes one team, and refuses two entries', async () => {
  const { service, client } = setup();
  await service.updateItem({ boardId: 'b', itemId: 'i1', values: { Lead: 'team:Cooks' } });
  assert.deepEqual(stored(client, 'i1', 'one'), {
    personsAndTeams: [{ id: 't-cooks', kind: 'team' }],
  });
  await assert.rejects(
    service.updateItem({ boardId: 'b', itemId: 'i1', values: { Lead: ['team:Cooks', 'me'] } }),
    /holds one person or team/,
  );
});

test('people cells read back with names: persons, teams and a deleted team', async () => {
  const { service } = setup({
    extra: {
      'boards/b/items/i3': item({
        name: 'Mixed',
        position: 'a2',
        values: {
          who: {
            personsAndTeams: [
              { id: JORDAN, kind: 'person' },
              { id: 't-kids', kind: 'team' },
              { id: 't-gone', kind: 'team' },
              { id: 'user-left', kind: 'person' },
            ],
          },
        },
      }),
    },
  });
  const { items } = await service.getBoard({ boardId: 'b' });
  assert.deepEqual(byName({ items }).Mixed.values.Owner, [
    { id: JORDAN, kind: 'person', name: 'Jordan Lee' },
    { id: 't-kids', kind: 'team', name: 'Kids' },
    { id: 't-gone', kind: 'team', name: 'Deleted team' },
    { id: 'user-left', kind: 'person', name: null },
  ]);
});

test('find_items equals on a People column matches an id or a name', async () => {
  const { service } = setup({
    extra: {
      'boards/b/items/i3': item({
        name: 'Kids chore',
        position: 'a2',
        values: { who: { personsAndTeams: [{ id: 't-kids', kind: 'team' }] } },
      }),
      'boards/b/items/i4': item({
        name: 'Jordan chore',
        position: 'a3',
        values: { who: { personsAndTeams: [{ id: JORDAN, kind: 'person' }] } },
      }),
    },
  });
  const names = async (equals) =>
    (await service.findItems({ boardId: 'b', where: [{ column: 'Owner', equals }] })).items.map(
      (i) => i.name,
    );
  assert.deepEqual(await names('kids'), ['Kids chore']);
  assert.deepEqual(await names('t-kids'), ['Kids chore']);
  assert.deepEqual(await names('Jordan Lee'), ['Jordan chore']);
  assert.deepEqual(await names(JORDAN), ['Jordan chore']);
  assert.deepEqual(await names(null), ['Pizza', 'Pasta']);
});

// ---- list_teams and members from member docs ------------------------------------------------------

test('list_teams lists the teams by name with their current members only', async () => {
  const { service } = setup();
  const { workspaceId, teams } = await service.listTeams();
  assert.equal(workspaceId, WS);
  assert.deepEqual(teams, [
    {
      id: 't-cooks',
      name: 'Cooks',
      color: '#ff642e',
      members: [{ uid: JORDAN, name: 'Jordan Lee' }],
    },
    // OUTSIDER is not a workspace member (a stale uid) and is left out.
    { id: 't-kids', name: 'Kids', color: '#579bfc', members: [{ uid: SAM, name: 'Sam Reed' }] },
  ]);
  await assert.rejects(
    service.listTeams({ workspaceId: 'elsewhere' }),
    /not found among your workspaces/,
  );
});

test('members come from the workspace member docs, never from users/{uid}', async () => {
  const { service, client } = setup({
    extra: {
      // Private user docs of other people: a read of these would be wrong (and is spied on below).
      [`users/${JORDAN}`]: { displayName: 'WRONG', email: 'wrong@example.com' },
      [`users/${SAM}`]: { displayName: 'WRONG', email: 'wrong@example.com' },
    },
  });
  const reads = [];
  for (const method of ['getDoc', 'getDocMeta', 'listAllDocs']) {
    const original = client[method].bind(client);
    client[method] = (path, ...rest) => {
      reads.push(path);
      return original(path, ...rest);
    };
  }
  const { members } = await service.listMembers();
  assert.deepEqual(
    members.map((m) => m.name),
    ['Avery Quinn', 'Jordan Lee', 'Sam Reed'],
  );
  const found = await service.findMember({ email: 'JORDAN@example.com' });
  assert.equal(found.member.name, 'Jordan Lee');
  await service.updateItem({ boardId: 'b', itemId: 'i1', values: { Owner: 'sam@example.com' } });
  await service.getBoard({ boardId: 'b' });
  await service.listMembers({ boardId: 'b' });
  assert.deepEqual(
    reads.filter((p) => p.startsWith('users/')),
    [],
  );
});

test('member listings add only the shared profile fields that are set', async () => {
  const { service } = setup();
  const { members } = await service.listMembers();
  assert.deepEqual(members[1], {
    uid: JORDAN,
    name: 'Jordan Lee',
    email: 'jordan@example.com',
    workspaceRole: 'member',
    me: false,
    title: 'Cook',
    location: 'Lyon',
  });
  assert.deepEqual(members[2], {
    uid: SAM,
    name: 'Sam Reed',
    email: 'sam@example.com',
    workspaceRole: 'member',
    me: false,
    timeZone: 'Europe/Paris',
  });
  assert.equal('about' in members[1], false, 'about and birthday are never shared');
  assert.equal('title' in members[0], false);
  const found = await service.findMember({ email: 'jordan@example.com' });
  assert.equal(found.member.title, 'Cook');
  // On a board listing too (the people who can see it).
  const onBoard = await service.listMembers({ boardId: 'b' });
  assert.deepEqual(
    onBoard.members.map((m) => m.uid),
    [ME],
  );
});

test('a member without a member doc still lists, named by their uid', async () => {
  const { service, client } = setup();
  client.docs.delete(`workspaces/${WS}/members/${SAM}`);
  const { members } = await service.listMembers();
  assert.deepEqual(members.at(-1), {
    uid: SAM,
    name: SAM,
    email: null,
    workspaceRole: 'member',
    me: false,
  });
});

// ---- client queries ------------------------------------------------------------------------------

test('fake client runQuery: nested path, arrayContainsAny, limit and orderBy', async () => {
  const client = createFakeClient({
    'boards/b1/items/a': { assignees: ['x'], n: 2, state: 'active' },
    'boards/b1/items/b': { assignees: ['y', 'z'], n: 1, state: 'active' },
    'boards/b1/items/c': { assignees: [], n: 3, state: 'archived' },
    'boards/b1/items/c/updates/u1': { n: 9 },
    'boards/b2/items/d': { assignees: ['x'], n: 4 },
  });
  const ids = (rows) => rows.map((r) => r.id);
  assert.deepEqual(ids(await client.runQuery('boards/b1/items')), ['a', 'b', 'c']);
  assert.deepEqual(ids(await client.runQuery('boards/b1/items', { state: 'active' })), ['a', 'b']);
  assert.deepEqual(
    ids(await client.runQuery('boards/b1/items', { assignees: { arrayContainsAny: ['x', 'z'] } })),
    ['a', 'b'],
  );
  assert.deepEqual(
    ids(await client.runQuery('boards/b1/items', { assignees: { arrayContainsAny: ['nobody'] } })),
    [],
  );
  assert.deepEqual(
    ids(
      await client.runQuery('boards/b1/items', {}, { orderBy: { field: 'n', direction: 'desc' } }),
    ),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    ids(await client.runQuery('boards/b1/items', {}, { orderBy: { field: 'n' }, limit: 2 })),
    ['b', 'a'],
  );
  assert.deepEqual(ids(await client.runQuery('boards/b1/items', {}, { limit: 1 })), ['a']);
  assert.deepEqual(ids(await client.runQuery('boards/b1/items/c/updates')), ['u1']);
  await assert.rejects(
    client.runQuery('boards/b1/items', { state: 'active' }, { orderBy: { field: 'n' } }),
    /orderBy is only supported without filters/,
  );
  await assert.rejects(
    client.runQuery('boards/b1/items', {
      assignees: { arrayContainsAny: Array.from({ length: 31 }, (_, i) => `u${i}`) },
    }),
    /at most 30/,
  );
});
