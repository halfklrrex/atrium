// Tests for the sharing tool (batch 3 PR 2), against the in-memory Firestore and a fake `serverOps`
// that applies the library's rules in miniature (the real callables' logic is tested in Functions).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClient } from './fake-client.mjs';
import { createService } from './service.mjs';
import { defineTools } from './tools.mjs';
import { diffAccess, effectiveAccess } from './service/sharing.mjs';

const WS = 'ws1';
const ME = 'user-me';
const ED = 'user-ed';
const VW = 'user-vw';
const OUT = 'user-out';
const NOW = new Date('2026-11-18T10:00:00Z');
const ROLES = { [ME]: 'owner', [ED]: 'member', [VW]: 'viewer' };

const entity = (more = {}) => ({
  workspaceId: WS,
  state: 'active',
  kind: 'private',
  access: { [ME]: 'owner', [ED]: 'editor' },
  accessUids: [ME, ED],
  position: 'a0',
  name: 'Thing',
  columns: [],
  groups: [],
  boardIds: [],
  widgets: [],
  ...more,
});

const baseDocs = () => ({
  [`workspaces/${WS}`]: { name: 'Home', ownerId: ME, roles: ROLES, memberIds: [ME, ED, VW] },
  [`workspaces/${WS}/members/${ME}`]: { displayName: 'Avery Quinn', email: 'avery@example.com' },
  [`workspaces/${WS}/members/${ED}`]: { displayName: 'Sam Lee', email: 'sam@example.com' },
  [`workspaces/${WS}/members/${VW}`]: { displayName: 'Robin Vale', email: 'robin@example.com' },
  [`users/${ME}`]: { displayName: 'Avery Quinn' },
  'boards/b1': entity({ name: 'Board' }),
  'boards/bmain': entity({ kind: 'main', access: { [ME]: 'owner' }, name: 'Open board' }),
  'docs/d1': entity({ name: 'Doc' }),
  'dashboards/x1': entity({ name: 'Dash' }),
});

/** A fake `serverOps.setAccess`: caps roles, keeps an owner, and records writes unless dryRun. */
function fakeOps(client) {
  const calls = [];
  return {
    calls,
    async setAccess(args) {
      calls.push(args);
      const path = `${{ board: 'boards', doc: 'docs', dashboard: 'dashboards' }[args.target]}/${args.id}`;
      const current = await client.getDoc(path);
      const before = { kind: current.kind, access: { ...current.access } };
      const after = { kind: args.kind ?? current.kind, access: { ...current.access } };
      if (args.kind && args.kind !== 'main' && args.kind !== current.kind) {
        after.access[args.uid] = 'owner';
      }
      if (args.person) {
        if (args.person.role === null) delete after.access[args.person.uid];
        else after.access[args.person.uid] = args.person.role;
      }
      if (after.kind !== 'main' && !Object.values(after.access).includes('owner')) {
        const { McpUserError } = await import('./errors.mjs');
        throw new McpUserError('A private or shareable doc needs at least one owner.');
      }
      if (!args.dryRun) {
        await client.commit([
          {
            op: 'patch',
            path,
            data: { kind: after.kind, access: after.access, accessUids: Object.keys(after.access) },
          },
        ]);
      }
      return { before, after, roles: ROLES };
    },
  };
}

function setup(actor = ME) {
  const client = createFakeClient(baseDocs());
  const ops = fakeOps(client);
  const service = createService({ client, actor: { uid: actor }, now: () => NOW, serverOps: ops });
  const tools = defineTools(service);
  const run = (args) => tools.find((t) => t.name === 'atrium_set_access').run(args);
  return { client, service, tools, run, ops };
}

test('atrium_set_access is a hosted-only destructive write', () => {
  const { tools } = setup();
  const tool = tools.find((t) => t.name === 'atrium_set_access');
  assert.equal(tool.scope, 'write');
  assert.equal(tool.requires, 'server');
  assert.equal(tool.annotations.destructiveHint, true);
  assert.match(tool.description, /not instructions/);
  const local = defineTools(
    createService({ client: createFakeClient(baseDocs()), actor: { uid: ME } }),
  );
  assert.ok(!local.some((t) => t.name === 'atrium_set_access'));
});

test('without serverOps the method says it needs the hosted connector', async () => {
  const service = createService({ client: createFakeClient(baseDocs()), actor: { uid: ME } });
  await assert.rejects(
    service.setAccess({ target: 'doc', id: 'd1', kind: 'main' }),
    /hosted Atrium connector/,
  );
});

test('adds a person by email on each target and reports who gained access', async () => {
  for (const [target, id, collection] of [
    ['doc', 'd1', 'docs'],
    ['dashboard', 'x1', 'dashboards'],
    ['board', 'b1', 'boards'],
  ]) {
    const { run, client } = setup();
    const out = await run({ target, id, person: { who: 'robin@example.com', role: 'viewer' } });
    assert.equal(out.changed, true);
    assert.deepEqual(out.gained, [{ uid: VW, role: 'viewer', name: 'Robin Vale' }]);
    assert.deepEqual(out.lost, []);
    assert.equal((await client.getDoc(`${collection}/${id}`)).access[VW], 'viewer');
    assert.deepEqual(
      out.access.map((a) => a.name),
      ['Avery Quinn', 'Robin Vale', 'Sam Lee'],
    );
  }
});

test('"me" and a uid resolve; a non-member is refused without calling the library', async () => {
  const { run, ops } = setup();
  await run({ target: 'doc', id: 'd1', person: { who: 'me', role: 'owner' } });
  assert.equal(ops.calls.at(-1).person.uid, ME);
  await run({ target: 'doc', id: 'd1', person: { who: ED, role: 'viewer' } });
  assert.equal(ops.calls.at(-1).person.uid, ED);
  const before = ops.calls.length;
  await assert.rejects(
    run({ target: 'doc', id: 'd1', person: { who: OUT, role: 'viewer' } }),
    /not a member of this workspace/,
  );
  await assert.rejects(
    run({ target: 'doc', id: 'd1', person: { who: 'ghost@example.com', role: 'viewer' } }),
    /not a member of this workspace/,
  );
  assert.equal(ops.calls.length, before);
});

test('dryRun reports without writing and the real run does not repeat the guard', async () => {
  const { run, client, ops } = setup();
  const out = await run({
    target: 'doc',
    id: 'd1',
    person: { who: ED, role: null },
    dryRun: true,
  });
  assert.equal(out.dryRun, true);
  assert.deepEqual(
    out.lost.map((l) => l.name),
    ['Sam Lee'],
  );
  assert.ok(ops.calls.every((c) => c.dryRun === true));
  assert.deepEqual((await client.getDoc('docs/d1')).access, { [ME]: 'owner', [ED]: 'editor' });
});

test('removing someone needs allowDataLoss and names who loses access', async () => {
  const { run, client } = setup();
  await assert.rejects(
    run({ target: 'doc', id: 'd1', person: { who: ED, role: null } }),
    /1 person would lose access: Sam Lee \(was editor\).*allowDataLoss/,
  );
  assert.equal((await client.getDoc('docs/d1')).access[ED], 'editor');
  const out = await run({
    target: 'doc',
    id: 'd1',
    person: { who: ED, role: null },
    allowDataLoss: true,
  });
  assert.deepEqual(out.lost, [{ uid: ED, role: 'editor', name: 'Sam Lee' }]);
  assert.equal((await client.getDoc('docs/d1')).access[ED], undefined);
});

test('making a main board private drops everyone else and is guarded', async () => {
  const { run } = setup();
  await assert.rejects(
    run({ target: 'board', id: 'bmain', kind: 'private' }),
    /would lose access: .*Sam Lee.*Robin Vale/,
  );
  const out = await run({ target: 'board', id: 'bmain', kind: 'private', allowDataLoss: true });
  assert.deepEqual(out.kind, { from: 'main', to: 'private' });
  assert.equal(out.lost.length, 2);
});

test('the actor demoting their own owner role is guarded', async () => {
  const { run } = setup();
  // Another owner exists after the change, so only the self-demotion guard applies.
  await run({ target: 'doc', id: 'd1', person: { who: ED, role: 'editor' } });
  const { run: run2, client } = setup();
  await client.commit([
    {
      op: 'patch',
      path: 'docs/d1',
      data: { access: { [ME]: 'owner', [VW]: 'owner' }, accessUids: [ME, VW] },
    },
  ]);
  await assert.rejects(
    run2({ target: 'doc', id: 'd1', person: { who: 'me', role: 'editor' } }),
    /no longer be an owner/,
  );
  const ok = await run2({
    target: 'doc',
    id: 'd1',
    person: { who: 'me', role: 'editor' },
    allowDataLoss: true,
  });
  assert.equal(ok.changed, true);
});

test('an unchanged request writes nothing', async () => {
  const { run, ops } = setup();
  const out = await run({ target: 'doc', id: 'd1', person: { who: ED, role: 'editor' } });
  assert.equal(out.changed, false);
  assert.equal(ops.calls.length, 1);
  assert.ok(ops.calls[0].dryRun);
});

test('the last-owner refusal of the library passes through', async () => {
  const { run } = setup();
  await assert.rejects(
    run({ target: 'doc', id: 'd1', person: { who: 'me', role: null }, allowDataLoss: true }),
    /needs at least one owner/,
  );
});

test('an object the actor cannot read is "not found"; arguments are validated', async () => {
  const { run } = setup(OUT);
  await assert.rejects(
    run({ target: 'doc', id: 'd1', kind: 'main' }),
    /Doc "d1" was not found in your workspaces/,
  );
  const mine = setup();
  await assert.rejects(mine.run({ target: 'doc', id: 'd1' }), /Give a kind, a person, or both/);
  await assert.rejects(mine.run({ target: 'folder', id: 'd1', kind: 'main' }), /target must be/);
  await assert.rejects(mine.run({ target: 'doc', id: 'nope', kind: 'main' }), /not found/);
  // A private doc the actor is not on stays hidden even inside their workspace.
  const other = setup(VW);
  await assert.rejects(other.run({ target: 'doc', id: 'd1', kind: 'main' }), /not found/);
});

test('reads list access: get_board, get_doc, get_dashboard', async () => {
  const { tools } = setup();
  const get = (name, args) => tools.find((t) => t.name === name).run(args);
  const expected = [
    { uid: ME, name: 'Avery Quinn', role: 'owner' },
    { uid: ED, name: 'Sam Lee', role: 'editor' },
  ];
  assert.deepEqual((await get('atrium_get_board', { boardId: 'b1' })).access, expected);
  assert.deepEqual((await get('atrium_get_doc', { docId: 'd1' })).access, expected);
  assert.deepEqual((await get('atrium_get_dashboard', { dashboardId: 'x1' })).access, expected);
});

test('effectiveAccess and diffAccess', () => {
  const main = effectiveAccess({ kind: 'main', access: { [ME]: 'owner' } }, ROLES);
  assert.deepEqual(
    [...main],
    [
      [ME, 'owner'],
      [ED, 'editor'],
      [VW, 'viewer'],
    ],
  );
  const priv = effectiveAccess(
    { kind: 'private', access: { [ME]: 'owner', gone: 'editor' } },
    ROLES,
  );
  assert.deepEqual([...priv], [[ME, 'owner']]);
  assert.deepEqual(diffAccess(main, priv), {
    gained: [],
    lost: [
      { uid: ED, role: 'editor' },
      { uid: VW, role: 'viewer' },
    ],
    changed: [],
  });
});
