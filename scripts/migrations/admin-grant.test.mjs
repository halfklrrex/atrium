// Tests for `pnpm admin:grant` (scripts/admin-grant.mjs). It lives here because this folder's tests
// run through tsx, which the script needs (it imports @atrium/shared).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCliArgs, resolveOptions, runGrant } from '../admin-grant.mjs';

const quiet = () => {};

function fakeAuth(users) {
  const store = new Map(users.map((u) => [u.uid, structuredClone(u)]));
  return {
    describe: 'fake auth',
    store,
    sets: [],
    async getUser(uid) {
      return store.has(uid) ? structuredClone(store.get(uid)) : null;
    },
    async setCustomClaims(uid, claims) {
      this.sets.push(uid);
      store.get(uid).customClaims = structuredClone(claims);
    },
  };
}

test('a dry run reports and writes nothing', async () => {
  const auth = fakeAuth([{ uid: 'u1', customClaims: {} }]);
  const result = await runGrant({ auth, uid: 'u1', log: quiet });
  assert.equal(result.changed, true);
  assert.equal(result.applied, false);
  assert.equal(auth.sets.length, 0);
});

test('apply sets admin and acct and keeps other claims', async () => {
  const auth = fakeAuth([{ uid: 'u1', customClaims: { other: 7, acct: 'approved' } }]);
  const result = await runGrant({ auth, uid: 'u1', apply: true, log: quiet });
  assert.equal(result.applied, true);
  assert.deepEqual(auth.store.get('u1').customClaims, { other: 7, acct: 'approved', admin: true });
});

test('also approves a pending admin', async () => {
  const auth = fakeAuth([{ uid: 'u1', customClaims: {} }]);
  await runGrant({ auth, uid: 'u1', apply: true, log: quiet });
  assert.deepEqual(auth.store.get('u1').customClaims, { acct: 'approved', admin: true });
});

test('is idempotent', async () => {
  const auth = fakeAuth([{ uid: 'u1', customClaims: { acct: 'approved', admin: true } }]);
  const result = await runGrant({ auth, uid: 'u1', apply: true, log: quiet });
  assert.equal(result.changed, false);
  assert.equal(auth.sets.length, 0);
});

test('refuses an unknown or blocked user', async () => {
  const auth = fakeAuth([{ uid: 'u2', customClaims: { acct: 'blocked' } }]);
  await assert.rejects(runGrant({ auth, uid: 'nope', apply: true, log: quiet }), /No Auth user/);
  await assert.rejects(runGrant({ auth, uid: 'u2', apply: true, log: quiet }), /blocked/);
  assert.equal(auth.sets.length, 0);
});

test('options: --uid is required, emulator by default', () => {
  assert.throws(() => resolveOptions(parseCliArgs([])), /--uid/);
  const o = resolveOptions(parseCliArgs(['--uid', 'u1']));
  assert.equal(o.target, 'emulator');
  assert.equal(o.apply, false);
  const p = resolveOptions(parseCliArgs(['--uid', 'u1', '--project', 'my-proj-1', '--apply']));
  assert.equal(p.target, 'production');
  assert.equal(p.quotaProject, 'my-proj-1');
});
