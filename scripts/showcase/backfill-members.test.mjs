// Tests of the members backfill: the plan logic and dry run / write against a fake client.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMemberDoc, planWorkspace, runBackfill } from '../backfill-members.mjs';

const NOW = new Date('2026-10-26T12:00:00Z');
const CREATED = new Date('2026-01-01T00:00:00Z');

function fakeClient(store) {
  const commits = [];
  const children = (prefix) => [
    ...new Set(
      [...store.keys()]
        .filter((p) => p.startsWith(`${prefix}/`))
        .map((p) => p.slice(prefix.length + 1).split('/')[0]),
    ),
  ];
  return {
    commits,
    describe: 'fake',
    getDoc: async (path) => store.get(path) ?? null,
    listAllDocs: async (c) =>
      children(c).flatMap((id) =>
        store.has(`${c}/${id}`) ? [{ id, data: store.get(`${c}/${id}`) }] : [],
      ),
    commit: async (writes) => {
      commits.push(writes);
      for (const w of writes) store.set(w.path, { ...store.get(w.path), ...w.data });
    },
  };
}

const world = () =>
  new Map([
    [
      'workspaces/w1',
      {
        name: 'Team',
        createdAt: CREATED,
        memberIds: ['u1', 'u2', 'u3'],
        roles: { u1: 'owner', u2: 'member', u3: 'viewer' },
      },
    ],
    [
      'users/u1',
      {
        displayName: 'Avery Quinn',
        email: 'Avery@Example.com',
        photoURL: 'https://example.com/a.png',
      },
    ],
    ['users/u2', { displayName: '', email: 'jordan@example.com', photoURL: null }],
    // u3 has no user doc at all.
    ['workspaces/w1/members/u3', { displayName: 'Sam', email: 'sam@example.com', role: 'member' }],
    [
      'workspaces/w2',
      { name: 'Solo', createdAt: CREATED, memberIds: ['u1'], roles: { u1: 'owner' } },
    ],
    [
      'workspaces/w2/members/u1',
      { displayName: 'Avery Quinn', email: 'avery@example.com', role: 'owner' },
    ],
  ]);

test('buildMemberDoc copies the profile, lowercases the email and falls back sensibly', () => {
  const doc = buildMemberDoc({
    user: {
      displayName: 'Avery Quinn',
      email: 'Avery@Example.com',
      photoURL: 'https://example.com/a.png',
    },
    role: 'owner',
    joinedAt: CREATED,
    now: NOW,
  });
  assert.deepEqual(doc, {
    displayName: 'Avery Quinn',
    photoURL: 'https://example.com/a.png',
    email: 'avery@example.com',
    role: 'owner',
    joinedAt: CREATED,
    updatedAt: NOW,
  });
  const bare = buildMemberDoc({ user: undefined, role: 'viewer', now: NOW });
  assert.deepEqual(bare, {
    displayName: '',
    photoURL: null,
    email: '',
    role: 'viewer',
    joinedAt: NOW,
    updatedAt: NOW,
  });
  // No display name: the email stands in.
  assert.equal(
    buildMemberDoc({ user: { email: 'jordan@example.com' }, role: 'member', now: NOW }).displayName,
    'jordan@example.com',
  );
});

test('planWorkspace creates missing docs and fixes stale roles only', () => {
  const plan = planWorkspace({
    workspace: { createdAt: CREATED, roles: { u1: 'owner', u2: 'member', u3: 'viewer' } },
    members: new Map([['u3', { role: 'member' }]]),
    users: new Map(),
    now: NOW,
  });
  assert.deepEqual(
    plan.creates.map((c) => c.uid),
    ['u1', 'u2'],
  );
  assert.deepEqual(plan.fixes, [{ uid: 'u3', from: 'member', to: 'viewer' }]);
});

test('a dry run writes nothing', async () => {
  const store = world();
  const client = fakeClient(store);
  const summary = await runBackfill({ client, dryRun: true, now: NOW, log: () => undefined });
  assert.deepEqual(summary, { workspaces: 2, created: 2, fixed: 1, unchanged: 1 });
  assert.equal(client.commits.length, 0);
  assert.ok(!store.has('workspaces/w1/members/u1'));
});

test('a real run creates and fixes, never deletes, and converges', async () => {
  const store = world();
  const client = fakeClient(store);
  await runBackfill({ client, dryRun: false, now: NOW, log: () => undefined });
  assert.ok(client.commits.flat().every((w) => w.op === 'set' || w.op === 'patch'));
  assert.equal(store.get('workspaces/w1/members/u1').displayName, 'Avery Quinn');
  assert.equal(store.get('workspaces/w1/members/u1').email, 'avery@example.com');
  assert.equal(store.get('workspaces/w1/members/u2').displayName, 'jordan@example.com');
  assert.equal(store.get('workspaces/w1/members/u3').role, 'viewer');
  // The workspace itself and the user docs are never written.
  assert.ok(client.commits.flat().every((w) => /^workspaces\/[^/]+\/members\/[^/]+$/.test(w.path)));
  const again = await runBackfill({ client, dryRun: false, now: NOW, log: () => undefined });
  assert.deepEqual(again, { workspaces: 2, created: 0, fixed: 0, unchanged: 4 });
});

test('--workspace limits the run to one workspace and refuses a missing one', async () => {
  const client = fakeClient(world());
  const only = await runBackfill({
    client,
    workspaceId: 'w2',
    dryRun: true,
    now: NOW,
    log: () => undefined,
  });
  assert.deepEqual(only, { workspaces: 1, created: 0, fixed: 0, unchanged: 1 });
  await assert.rejects(
    runBackfill({ client, workspaceId: 'nope', dryRun: true, now: NOW, log: () => undefined }),
    /does not exist/,
  );
});
