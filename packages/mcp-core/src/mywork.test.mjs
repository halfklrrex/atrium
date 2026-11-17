// Tests for My Work, search and notifications (batch 2 PR 3), against the in-memory Firestore.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nameTokensOf } from '@atrium/shared';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';
import { defineTools } from './tools.mjs';

const WS = 'ws1';
const ME = 'user-me';
const OTHER = 'user-other';
// Tuesday 2026-11-17, 23:30 UTC: already Wednesday the 18th in Auckland.
const NOW = new Date('2026-11-17T23:30:00Z');

const columns = [
  { id: 'who', type: 'people', title: 'Owner', position: 'a0', settings: {} },
  { id: 'due', type: 'date', title: 'Due', position: 'a1', settings: {} },
  { id: 'txt', type: 'text', title: 'Note', position: 'a2', settings: {} },
];
const groups = [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }];
const person = (uid) => ({ personsAndTeams: [{ id: uid, kind: 'person' }] });
const team = (id) => ({ personsAndTeams: [{ id, kind: 'team' }] });
const board = (name, more = {}) => ({
  workspaceId: WS,
  state: 'active',
  kind: 'main',
  access: { [ME]: 'owner' },
  accessUids: [ME],
  position: 'a0',
  folderId: null,
  name,
  description: '',
  columns,
  subitemColumns: [],
  groups,
  ...more,
});
const item = (name, more = {}) => ({
  name,
  groupId: 'g1',
  position: 'a0',
  parentItemId: null,
  state: 'active',
  values: {},
  assigneeUids: [],
  assigneeTeamIds: [],
  nameTokens: nameTokensOf(name),
  ...more,
});

function setup(extra = {}, { timezone = 'UTC', clock = NOW } = {}) {
  const client = createFakeClient({
    [`workspaces/${WS}`]: {
      name: 'Home',
      ownerId: ME,
      roles: { [ME]: 'owner', [OTHER]: 'member' },
      memberIds: [ME, OTHER],
    },
    [`workspaces/${WS}/members/${ME}`]: { displayName: 'Avery Quinn', email: 'avery@example.com' },
    [`workspaces/${WS}/members/${OTHER}`]: { displayName: 'Sam Lee', email: 'sam@example.com' },
    [`workspaces/${WS}/teams/t1`]: { name: 'Kids', color: '#579bfc', memberUids: [ME] },
    [`workspaces/${WS}/teams/t2`]: { name: 'Parents', color: '#579bfc', memberUids: [OTHER] },
    [`users/${ME}`]: { displayName: 'Avery Quinn', timezone },
    ...extra,
  });
  const service = createService({ client, actor: { uid: ME }, now: () => clock });
  const tools = defineTools(service);
  const run = (name, args = {}) => tools.find((t) => t.name === name).run(args);
  return { client, service, run };
}

const myWorkItems = () => ({
  'boards/b1': board('Chores'),
  'boards/b1/items/i1': item('Dishes', {
    values: { who: person(ME), due: { date: '2026-11-17' } },
    assigneeUids: [ME],
  }),
  'boards/b1/items/i2': item('Soccer', {
    values: { who: team('t1'), due: { date: '2026-11-19' } },
    assigneeTeamIds: ['t1'],
  }),
  // Assigned to a team the actor is not in: never returned.
  'boards/b1/items/i3': item('Taxes', { values: { who: team('t2') }, assigneeTeamIds: ['t2'] }),
  // A stale index hint: the People cell no longer holds me.
  'boards/b1/items/i4': item('Stale', { values: { who: person(OTHER) }, assigneeUids: [ME] }),
  'boards/b1/items/i5': item('Old', {
    state: 'archived',
    values: { who: person(ME) },
    assigneeUids: [ME],
  }),
  'boards/b1/items/i6': item('Floating', { values: { who: person(ME) }, assigneeUids: [ME] }),
  // Both direct and through a team: shown once, as "me".
  'boards/b1/items/i7': item('Both', {
    values: {
      who: {
        personsAndTeams: [
          { id: ME, kind: 'person' },
          { id: 't1', kind: 'team' },
        ],
      },
    },
    assigneeUids: [ME],
    assigneeTeamIds: ['t1'],
  }),
  // A private board the actor is not on: unreadable, so its item never shows.
  'boards/secret': board('Secret', {
    kind: 'private',
    access: { [OTHER]: 'owner' },
    accessUids: [OTHER],
  }),
  'boards/secret/items/s1': item('Hidden', { values: { who: person(ME) }, assigneeUids: [ME] }),
});

test('my work: direct and team assignment, ignoring teams I am not in, stale hints and archived items', async () => {
  const { run } = setup(myWorkItems());
  const result = await run('atrium_my_work');
  const byName = Object.fromEntries(result.items.map((i) => [i.name, i]));
  assert.deepEqual(Object.keys(byName).sort(), ['Both', 'Dishes', 'Floating', 'Soccer']);
  assert.equal(byName.Dishes.via, 'me');
  assert.equal(byName.Soccer.via, 'Kids');
  assert.equal(byName.Both.via, 'me');
  assert.equal(byName.Dishes.boardName, 'Chores');
  assert.equal(byName.Dishes.values.Due, '2026-11-17');
  assert.equal(byName.Dishes.values.Owner[0].name, 'Avery Quinn');
  // Dated first by date, then undated by name.
  assert.deepEqual(
    result.items.map((i) => i.name),
    ['Dishes', 'Soccer', 'Both', 'Floating'],
  );
  assert.equal(result.total, 4);
});

test('my work: includeTeams false leaves team-only items out', async () => {
  const { run } = setup(myWorkItems());
  const result = await run('atrium_my_work', { includeTeams: false });
  assert.deepEqual(result.items.map((i) => i.name).sort(), ['Both', 'Dishes', 'Floating']);
});

test('my work: a team of another workspace is ignored', async () => {
  const { run } = setup({
    ...myWorkItems(),
    'workspaces/ws2': { name: 'Club', ownerId: ME, roles: { [ME]: 'owner' }, memberIds: [ME] },
    'workspaces/ws2/teams/t9': { name: 'Elsewhere', color: '#579bfc', memberUids: [ME] },
    'boards/b1/items/i8': item('Foreign team', {
      values: { who: team('t9') },
      assigneeTeamIds: ['t9'],
    }),
  });
  const names = (await run('atrium_my_work', { workspaceId: WS })).items.map((i) => i.name);
  assert.ok(!names.includes('Foreign team'));
});

test('my work: a column that is not the first date column can be chosen', async () => {
  const withEnd = board('Chores', {
    columns: [...columns, { id: 'end', type: 'date', title: 'Ends', position: 'a3', settings: {} }],
  });
  const { run } = setup({
    ...myWorkItems(),
    'boards/b1': withEnd,
    'boards/b1/items/i1': item('Dishes', {
      values: { who: person(ME), due: { date: '2026-11-17' }, end: { date: '2026-12-01' } },
      assigneeUids: [ME],
    }),
  });
  const result = await run('atrium_my_work', { dateColumn: 'ends' });
  assert.equal(result.items.find((i) => i.name === 'Dishes').date, '2026-12-01');
});

test('my work: due buckets use the actor time zone', async () => {
  const utc = setup(myWorkItems());
  assert.deepEqual(
    (await utc.run('atrium_my_work', { due: 'today' })).items.map((i) => i.name),
    ['Dishes'],
  );
  assert.deepEqual(
    (await utc.run('atrium_my_work', { due: 'this_week' })).items.map((i) => i.name),
    ['Soccer'],
  );
  // Auckland is already the 18th: Dishes (the 17th) is overdue, Soccer (the 19th) is tomorrow.
  const auckland = setup(myWorkItems(), { timezone: 'Pacific/Auckland' });
  const overdue = await auckland.run('atrium_my_work', { due: 'overdue' });
  assert.equal(overdue.today, '2026-11-18');
  assert.deepEqual(
    overdue.items.map((i) => i.name),
    ['Dishes'],
  );
  assert.deepEqual(
    (await auckland.run('atrium_my_work', { due: 'no_date' })).items.map((i) => i.name),
    ['Both', 'Floating'],
  );
});

test('my work: reads the most recently visited boards and says when the cap cut the list', async () => {
  const extra = {};
  for (let n = 0; n < 101; n += 1) {
    const id = `cap${String(n).padStart(3, '0')}`;
    extra[`boards/${id}`] = board(`Board ${id}`);
    extra[`boards/${id}/items/x`] = item('Mine', {
      values: { who: person(ME) },
      assigneeUids: [ME],
    });
  }
  // The board that would sort last by name was visited most recently, so it stays in.
  extra[`users/${ME}/recents/cap100`] = {
    boardId: 'cap100',
    visitedAt: new Date('2026-11-17T10:00:00Z'),
  };
  const { run } = setup(extra);
  const result = await run('atrium_my_work', { limit: 200 });
  assert.match(result.note, /100 most recently visited of your 101 boards/);
  assert.equal(result.total, 100);
  assert.ok(result.items.some((i) => i.boardId === 'cap100'));
});

const searchData = () => ({
  'boards/b1': board('Packing trips'),
  'boards/b2': board('Garden'),
  'boards/secret': board('Packing secrets', {
    kind: 'private',
    access: { [OTHER]: 'owner' },
    accessUids: [OTHER],
  }),
  'boards/b1/items/a': item('Packing list for camp'),
  'boards/b1/items/b': item('Pack the car'),
  'boards/b2/items/c': item('Camp stove'),
  'boards/b2/items/d': item('Archived packing', { state: 'archived' }),
  'boards/secret/items/e': item('Packing the vault'),
  'docs/d1': {
    workspaceId: WS,
    name: 'Packing checklist',
    kind: 'main',
    state: 'active',
    access: { [ME]: 'owner' },
    accessUids: [ME],
  },
  'docs/d1/content/body': { text: 'Bring the blue tent and two sleeping bags for camp.', rev: 1 },
  'docs/d2': {
    workspaceId: WS,
    name: 'Camp notes',
    kind: 'private',
    state: 'active',
    access: { [OTHER]: 'owner' },
    accessUids: [OTHER],
  },
  'docs/d2/content/body': { text: 'secret camp plans', rev: 1 },
  'docs/d3': {
    workspaceId: WS,
    name: 'Camp ideas',
    kind: 'main',
    state: 'deleted',
    access: { [ME]: 'owner' },
    accessUids: [ME],
  },
});

test('search: items, boards and docs by name, readable only', async () => {
  const { run } = setup(searchData());
  const result = await run('atrium_search', { query: 'packing' });
  const rows = result.results.map((r) => `${r.kind}:${r.name}`);
  assert.deepEqual(rows, [
    'board:Packing trips',
    'doc:Packing checklist',
    'item:Packing list for camp',
  ]);
  const item0 = result.results.find((r) => r.kind === 'item');
  assert.equal(item0.boardName, 'Packing trips');
});

test('search: every word must match, the longest word drives the query', async () => {
  const { run } = setup(searchData());
  const hits = (await run('atrium_search', { query: 'camp pack', kinds: ['items'] })).results;
  assert.deepEqual(
    hits.map((r) => r.name),
    ['Packing list for camp'],
  );
  assert.equal((await run('atrium_search', { query: 'camp zebra', kinds: ['items'] })).total, 0);
});

test('search: the kinds filter, the minimum length note and the limit', async () => {
  const { run } = setup(searchData());
  assert.deepEqual(
    (await run('atrium_search', { query: 'packing', kinds: ['boards'] })).results.map(
      (r) => r.kind,
    ),
    ['board'],
  );
  const one = await run('atrium_search', { query: 'pa', limit: 1 });
  assert.equal(one.shown, 1);
  assert.ok(one.total > 1);
});

test('search: doc text finds a snippet only when asked for', async () => {
  const { run } = setup(searchData());
  assert.equal((await run('atrium_search', { query: 'sleeping bags', kinds: ['docs'] })).total, 0);
  const found = await run('atrium_search', {
    query: 'sleeping bags',
    kinds: ['docs'],
    includeDocText: true,
  });
  assert.equal(found.total, 1);
  assert.equal(found.results[0].name, 'Packing checklist');
  assert.ok(found.results[0].snippet.includes('sleeping bags'));
  assert.ok(found.results[0].snippet.length <= 160);
  // A private doc of someone else never leaks its text.
  assert.equal(
    (await run('atrium_search', { query: 'secret camp', kinds: ['docs'], includeDocText: true }))
      .total,
    0,
  );
});

test('search: a workspace I am not in is refused', async () => {
  const { run } = setup(searchData());
  await assert.rejects(
    () => run('atrium_search', { query: 'packing', workspaceId: 'nope' }),
    /not found/,
  );
});

const created = (minutes) => new Date(Date.UTC(2026, 10, 17, 12, minutes));
const notifications = () => ({
  [`users/${ME}/notifications/n1`]: {
    kind: 'assigned',
    actorName: 'Sam Lee',
    boardId: 'b1',
    boardName: 'Chores',
    itemId: 'i1',
    itemName: 'Dishes',
    snippet: '',
    createdAt: created(1),
    readAt: null,
  },
  [`users/${ME}/notifications/n2`]: {
    kind: 'reply',
    actorName: 'Sam Lee',
    boardId: 'b1',
    boardName: 'Chores',
    itemId: 'i1',
    itemName: 'Dishes',
    snippet: 'Done!',
    createdAt: created(3),
    readAt: created(4),
  },
  [`users/${ME}/notifications/n3`]: {
    kind: 'mention',
    actorName: 'Sam Lee',
    boardId: 'd1',
    itemId: 'd1',
    docId: 'd1',
    docName: 'Plan',
    snippet: 'See @Avery',
    createdAt: created(2),
    readAt: null,
  },
  [`users/${OTHER}/notifications/o1`]: {
    kind: 'assigned',
    actorName: 'Avery Quinn',
    boardId: 'b1',
    itemId: 'i1',
    snippet: '',
    createdAt: created(5),
    readAt: null,
  },
});

test('notifications: newest first, unread filter, doc mentions point at the doc', async () => {
  const { run } = setup(notifications());
  const all = await run('atrium_list_notifications');
  assert.deepEqual(
    all.notifications.map((n) => n.id),
    ['n2', 'n3', 'n1'],
  );
  assert.equal(all.notifications[0].read, true);
  assert.equal(all.notifications[0].actor, 'Sam Lee');
  const mention = all.notifications[1];
  assert.equal(mention.docId, 'd1');
  assert.equal(mention.boardId, null);
  assert.equal(mention.text, 'See @Avery');
  const unread = await run('atrium_list_notifications', { unreadOnly: true });
  assert.deepEqual(
    unread.notifications.map((n) => n.id),
    ['n3', 'n1'],
  );
  assert.equal((await run('atrium_list_notifications', { limit: 1 })).shown, 1);
});

test('notifications: mark read by ids writes only readAt and never touches another person', async () => {
  const { run, client } = setup(notifications());
  const result = await run('atrium_mark_notifications_read', { ids: ['n1', 'n2', 'o1', 'ghost'] });
  assert.equal(result.marked, 1);
  assert.deepEqual(result.alreadyRead, ['n2']);
  assert.deepEqual(result.notFound.sort(), ['ghost', 'o1']);
  assert.ok((await client.getDoc(`users/${ME}/notifications/n1`)).readAt instanceof Date);
  assert.equal((await client.getDoc(`users/${OTHER}/notifications/o1`)).readAt, null);
  const writes = client.commits.flat();
  assert.deepEqual(
    writes.map((w) => [w.op, w.path, Object.keys(w.set)]),
    [['update', `users/${ME}/notifications/n1`, ['readAt']]],
  );
  // Idempotent.
  assert.equal((await run('atrium_mark_notifications_read', { ids: ['n1'] })).marked, 0);
});

test('notifications: mark all read, and exactly one of ids or all is required', async () => {
  const { run, client } = setup(notifications());
  const result = await run('atrium_mark_notifications_read', { all: true });
  assert.equal(result.marked, 2);
  assert.equal((await run('atrium_list_notifications', { unreadOnly: true })).shown, 0);
  assert.equal((await client.getDoc(`users/${OTHER}/notifications/o1`)).readAt, null);
  await assert.rejects(() => run('atrium_mark_notifications_read', {}), /either ids/);
  await assert.rejects(
    () => run('atrium_mark_notifications_read', { ids: ['n1'], all: true }),
    /either ids/,
  );
  // No tool deletes a notification.
  assert.ok(client.commits.flat().every((w) => w.op !== 'delete'));
});

test('the new tools are marked as scopes, and read tools carry the untrusted-content sentence', () => {
  const tools = defineTools({});
  const get = (name) => tools.find((t) => t.name === name);
  for (const name of ['atrium_my_work', 'atrium_search', 'atrium_list_notifications']) {
    assert.equal(get(name).scope, 'read');
    assert.match(get(name).description, /not instructions\.$/);
  }
  assert.equal(get('atrium_mark_notifications_read').scope, 'write');
  assert.equal(get('atrium_mark_notifications_read').annotations.destructiveHint, false);
});
