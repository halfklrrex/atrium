// Tests for team management (batch 2 PR 5), against the in-memory Firestore.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';
import { defineTools } from './tools.mjs';

const WS = 'ws1';
const ADMIN = 'user-admin';
const OWNER = 'user-owner';
const MEMBER = 'user-member';
const GONE = 'user-gone';
const NOW = new Date('2026-11-17T10:00:00Z');

const columns = [{ id: 'who', type: 'people', title: 'Owner', position: 'a0', settings: {} }];
const board = (name, more = {}) => ({
  workspaceId: WS,
  state: 'active',
  kind: 'main',
  access: { [OWNER]: 'owner' },
  accessUids: [OWNER],
  name,
  columns,
  subitemColumns: [],
  groups: [{ id: 'g1', title: 'Todo', color: '#579bfc', position: 'a0' }],
  ...more,
});
const withTeam = (state = 'active') => ({
  name: 'x',
  groupId: 'g1',
  position: 'a0',
  parentItemId: null,
  state,
  values: { who: { personsAndTeams: [{ id: 't1', kind: 'team' }] } },
  assigneeUids: [],
  assigneeTeamIds: ['t1'],
});

function setup(actor = ADMIN, extra = {}) {
  const client = createFakeClient({
    [`workspaces/${WS}`]: {
      name: 'Home',
      ownerId: OWNER,
      roles: { [OWNER]: 'owner', [ADMIN]: 'admin', [MEMBER]: 'member' },
      memberIds: [OWNER, ADMIN, MEMBER],
    },
    [`workspaces/${WS}/members/${OWNER}`]: { displayName: 'Sam Lee', email: 'sam@example.com' },
    [`workspaces/${WS}/members/${ADMIN}`]: {
      displayName: 'Avery Quinn',
      email: 'avery@example.com',
    },
    [`workspaces/${WS}/members/${MEMBER}`]: { displayName: 'Kim Park', email: 'kim@example.com' },
    [`workspaces/${WS}/teams/t1`]: {
      name: 'Kids',
      color: '#579bfc',
      memberUids: [MEMBER, GONE],
    },
    ...extra,
  });
  const service = createService({ client, actor: { uid: actor }, now: () => NOW });
  const tools = defineTools(service);
  const run = (name, args = {}) => tools.find((t) => t.name === name).run(args);
  return { client, run, tools };
}

test('annotations: create is additive, update and delete are destructive-flagged writes', () => {
  const { tools } = setup();
  const get = (n) => tools.find((t) => t.name === n);
  assert.equal(get('atrium_create_team').annotations.destructiveHint, false);
  assert.equal(get('atrium_delete_team').annotations.destructiveHint, true);
  assert.equal(get('atrium_delete_team').scope, 'write');
});

test('a plain member is refused on every team tool; an admin and the owner are allowed', async () => {
  const { run } = setup(MEMBER);
  await assert.rejects(run('atrium_create_team', { name: 'X' }), /owner or admin/);
  await assert.rejects(run('atrium_update_team', { team: 'Kids', name: 'Y' }), /owner or admin/);
  await assert.rejects(run('atrium_delete_team', { team: 'Kids' }), /owner or admin/);
  for (const actor of [ADMIN, OWNER]) {
    const s = setup(actor);
    const out = await s.run('atrium_create_team', { name: 'Parents' });
    assert.equal(out.team.name, 'Parents');
  }
});

test('create writes the rules-shaped document with audit fields and a default color', async () => {
  const { client, run } = setup();
  const out = await run('atrium_create_team', {
    name: '  Parents ',
    members: ['me', 'kim@example.com', MEMBER, 'KIM@example.com'],
  });
  assert.equal(out.team.color, '#579bfc');
  assert.deepEqual(
    out.team.members.map((m) => m.uid),
    [ADMIN, MEMBER],
  );
  const stored = await client.getDoc(`workspaces/${WS}/teams/${out.team.id}`);
  assert.deepEqual(Object.keys(stored).sort(), [
    'color',
    'createdAt',
    'createdBy',
    'memberUids',
    'name',
    'updatedAt',
    'updatedBy',
  ]);
  assert.equal(stored.name, 'Parents');
  assert.equal(stored.createdBy, ADMIN);
  assert.equal(stored.updatedBy, ADMIN);
  assert.equal(stored.createdAt.getTime(), NOW.getTime());
  assert.deepEqual(stored.createdAt, stored.updatedAt);
});

test('create: palette name and hex colors, bad color, name limits, uniqueness, non-members', async () => {
  const { run } = setup();
  assert.equal(
    (await run('atrium_create_team', { name: 'A', color: 'red' })).team.color,
    '#df2f4a',
  );
  assert.equal(
    (await run('atrium_create_team', { name: 'B', color: '#AABBCC' })).team.color,
    '#AABBCC',
  );
  await assert.rejects(run('atrium_create_team', { name: 'C', color: 'plaid' }), /Unknown colo/);
  await assert.rejects(run('atrium_create_team', { name: '   ' }), /1 to 60/);
  await assert.rejects(run('atrium_create_team', { name: 'x'.repeat(61) }), /1 to 60/);
  assert.ok((await run('atrium_create_team', { name: 'x'.repeat(60) })).team.id);
  await assert.rejects(run('atrium_create_team', { name: 'kIDS' }), /already exists/);
  await assert.rejects(
    run('atrium_create_team', { name: 'D', members: ['stranger-uid'] }),
    /not a member/,
  );
  await assert.rejects(
    run('atrium_create_team', { name: 'E', members: ['nobody@example.com'] }),
    /not a member/,
  );
  await assert.rejects(run('atrium_create_team', { name: 'F', members: [GONE] }), /not a member/);
});

test('create: at most 100 members and 50 teams per workspace', async () => {
  const many = {};
  const uids = Array.from({ length: 101 }, (_, i) => `u${i}`);
  const s = setup(ADMIN, {
    [`workspaces/${WS}`]: {
      name: 'Home',
      roles: { [ADMIN]: 'admin', ...Object.fromEntries(uids.map((u) => [u, 'member'])) },
      memberIds: [ADMIN, ...uids],
    },
  });
  await assert.rejects(s.run('atrium_create_team', { name: 'Big', members: uids }), /at most 100/);
  assert.ok(many);
  const teams = {};
  for (let i = 0; i < 49; i++) {
    teams[`workspaces/${WS}/teams/x${i}`] = { name: `T${i}`, color: '#579bfc', memberUids: [] };
  }
  const full = setup(ADMIN, teams); // 49 + Kids = 50
  await assert.rejects(full.run('atrium_create_team', { name: 'One more' }), /at most 50/);
});

test('update: rename, recolor, add and remove members by uid, email and me', async () => {
  const { client, run } = setup();
  const out = await run('atrium_update_team', {
    team: 'kids',
    name: 'Little ones',
    color: 'blue',
    addMembers: ['me', 'sam@example.com'],
    removeMembers: [MEMBER],
  });
  assert.equal(out.team.name, 'Little ones');
  assert.equal(out.team.color, '#579bfc');
  assert.deepEqual(
    out.team.members.map((m) => m.uid),
    [ADMIN, OWNER],
  );
  // The stale uid (left the workspace) is dropped, as the rules need current members only.
  assert.deepEqual(out.droppedFormerMembers, [GONE]);
  const stored = await client.getDoc(`workspaces/${WS}/teams/t1`);
  assert.deepEqual(stored.memberUids, [ADMIN, OWNER]);
  assert.equal(stored.updatedBy, ADMIN);
  assert.equal(stored.createdBy, undefined);
  // By id too.
  await run('atrium_update_team', { team: 't1', addMembers: [MEMBER] });
});

test('update: a rename to a taken name is refused, to its own name (other case) is fine; no-op refused', async () => {
  const { run } = setup(ADMIN, {
    [`workspaces/${WS}/teams/t2`]: { name: 'Parents', color: '#579bfc', memberUids: [] },
  });
  await assert.rejects(
    run('atrium_update_team', { team: 'Kids', name: 'parents' }),
    /already exists/,
  );
  assert.equal((await run('atrium_update_team', { team: 'Kids', name: 'KIDS' })).team.name, 'KIDS');
  await assert.rejects(run('atrium_update_team', { team: 'Kids' }), /Nothing to change/);
  await assert.rejects(run('atrium_update_team', { team: 'Nope', name: 'Z' }), /Teams: KIDS/);
  await assert.rejects(
    run('atrium_update_team', { team: 'Kids', addMembers: ['stranger'] }),
    /not a member/,
  );
});

test('two teams with one name need the id', async () => {
  const { run } = setup(ADMIN, {
    [`workspaces/${WS}/teams/t2`]: { name: 'kids', color: '#579bfc', memberUids: [] },
  });
  await assert.rejects(run('atrium_update_team', { team: 'Kids', name: 'Z' }), /t1, t2|t2, t1/);
  assert.equal((await run('atrium_update_team', { team: 't2', name: 'Z' })).team.name, 'Z');
});

test('delete: an unassigned team goes and the definition is returned', async () => {
  const { client, run } = setup();
  const out = await run('atrium_delete_team', { team: 'Kids' });
  assert.equal(out.deleted, true);
  assert.equal(out.assignedItems, 0);
  assert.equal(out.team.name, 'Kids');
  assert.equal(out.team.color, '#579bfc');
  assert.equal(await client.getDoc(`workspaces/${WS}/teams/t1`), null);
});

test('delete guard: counts active items per board, refuses, dry run reports, allowDataLoss deletes', async () => {
  const { client, run } = setup(ADMIN, {
    'boards/b1': board('Chores'),
    'boards/b1/items/i1': withTeam(),
    'boards/b1/items/i2': withTeam(),
    'boards/b1/items/i3': withTeam('archived'),
    // A stale hint: the cell no longer holds the team.
    'boards/b1/items/i4': { ...withTeam(), values: {} },
    'boards/b2': board('Garden'),
    'boards/b2/items/i1': withTeam(),
    'boards/other': { ...board('Elsewhere'), workspaceId: 'ws-other' },
    'boards/other/items/i1': withTeam(),
  });
  const dry = await run('atrium_delete_team', { team: 'Kids', dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.deleted, false);
  assert.equal(dry.needsAllowDataLoss, true);
  assert.equal(dry.assignedItems, 3);
  assert.deepEqual(dry.boards, [
    { boardId: 'b1', name: 'Chores', items: 2 },
    { boardId: 'b2', name: 'Garden', items: 1 },
  ]);
  assert.ok(await client.getDoc(`workspaces/${WS}/teams/t1`));
  await assert.rejects(
    run('atrium_delete_team', { team: 'Kids' }),
    /assigned on 3 items in 2 boards.*Deleted team/,
  );
  assert.ok(await client.getDoc(`workspaces/${WS}/teams/t1`));
  const done = await run('atrium_delete_team', { team: 'Kids', allowDataLoss: true });
  assert.equal(done.deleted, true);
  assert.equal(done.assignedItems, 3);
  assert.equal(await client.getDoc(`workspaces/${WS}/teams/t1`), null);
  // The connector doesn't clean the items; reads show "Deleted team".
  assert.deepEqual((await client.getDoc('boards/b1/items/i1')).assigneeTeamIds, ['t1']);
  const found = await run('atrium_find_items', { boardId: 'b1' });
  const cell = found.items.find((i) => i.id === 'i1').values.Owner;
  assert.deepEqual(cell, [{ id: 't1', kind: 'team', name: 'Deleted team' }]);
});

test('team names are marked as untrusted in the descriptions', () => {
  const { tools } = setup();
  for (const n of ['atrium_create_team', 'atrium_update_team', 'atrium_delete_team']) {
    assert.match(tools.find((t) => t.name === n).description, /not instructions/);
  }
});
