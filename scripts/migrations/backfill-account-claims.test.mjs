// Tests for the account-claims backfill: dry-run default, paging, claim preservation, idempotence,
// blocked accounts, accounts without a profile, and the Auth REST client's requests. Run through tsx.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthRest } from '../auth-rest.mjs';
import {
  CHANGED_BY,
  parseCliArgs,
  planUser,
  resolveOptions,
  runBackfill,
} from './2026-11-backfill-account-claims.mjs';

const quiet = () => {};

/** Fake Auth: pages of `pageSize` users, claims kept in memory. */
export function fakeAuth(users, pageSize = 2) {
  const store = new Map(users.map((u) => [u.uid, structuredClone(u)]));
  const auth = {
    describe: 'fake auth',
    store,
    pageRequests: [],
    sets: [],
    async listUsers(token) {
      auth.pageRequests.push(token);
      const all = [...store.values()];
      const start = token ? Number(token) : 0;
      const slice = all.slice(start, start + pageSize);
      return {
        users: slice.map((u) => structuredClone(u)),
        nextPageToken: start + pageSize < all.length ? String(start + pageSize) : undefined,
      };
    },
    async setCustomClaims(uid, claims) {
      auth.sets.push(uid);
      store.get(uid).customClaims = structuredClone(claims);
    },
  };
  return auth;
}

/** Fake Firestore with update times and preconditions for `users/*`. */
function fakeDb(docs) {
  const store = new Map(Object.entries(docs).map(([p, d]) => [p, structuredClone(d)]));
  const versions = new Map([...store.keys()].map((p) => [p, 1]));
  const db = {
    store,
    commits: [],
    async getDocMeta(path) {
      if (!store.has(path)) return null;
      return { data: structuredClone(store.get(path)), updateTime: `v${versions.get(path)}` };
    },
    async commit(writes) {
      for (const w of writes) {
        if (w.precondition?.updateTime !== `v${versions.get(w.path)}`) {
          throw Object.assign(new Error('precondition'), { status: 409 });
        }
      }
      db.commits.push(writes);
      for (const w of writes) {
        assert.equal(w.op, 'update');
        Object.assign(store.get(w.path), w.set);
        for (const f of w.serverTimestamp ?? []) store.get(w.path)[f] = 'SERVER_TIME';
        versions.set(w.path, versions.get(w.path) + 1);
      }
    },
  };
  return db;
}

const users = () => [
  { uid: 'u1', customClaims: {} },
  { uid: 'u2', customClaims: { admin: true, other: 'keep' } },
  { uid: 'u3', customClaims: { acct: 'approved' } },
  { uid: 'u4', customClaims: {} },
  { uid: 'u5', customClaims: { acct: 'blocked' } },
];
const profiles = () => ({
  'users/u1': { displayName: 'Avery', theme: 'light' },
  'users/u2': { displayName: 'Blair', accountStatus: 'pending' },
  'users/u3': { displayName: 'Casey', accountStatus: 'approved' },
  // u4 has no profile document.
  'users/u5': { displayName: 'Drew', accountStatus: 'blocked' },
});

test('a dry run reports and writes nothing', async () => {
  const auth = fakeAuth(users());
  const db = fakeDb(profiles());
  const lines = [];
  const result = await runBackfill({ auth, db, log: (l) => lines.push(l) });
  assert.equal(result.applied, false);
  assert.equal(result.scanned, 5);
  assert.equal(result.toChange, 3);
  assert.deepEqual(result.uids, ['u1', 'u2', 'u4']);
  assert.equal(auth.sets.length, 0);
  assert.equal(db.commits.length, 0);
  assert.ok(lines.join('\n').includes('u1, u2, u4'));
  assert.ok(!lines.join('\n').includes('Avery'), 'never prints names');
});

test('pages through every user', async () => {
  const auth = fakeAuth(users(), 2);
  await runBackfill({ auth, db: fakeDb(profiles()), log: quiet });
  assert.deepEqual(auth.pageRequests, [undefined, '2', '4']);
});

test('apply sets the claim, keeps other claims and writes the status', async () => {
  const auth = fakeAuth(users());
  const db = fakeDb(profiles());
  const result = await runBackfill({ auth, db, apply: true, log: quiet });
  assert.equal(result.changed, 3);
  assert.deepEqual(auth.store.get('u1').customClaims, { acct: 'approved' });
  assert.deepEqual(auth.store.get('u2').customClaims, {
    admin: true,
    other: 'keep',
    acct: 'approved',
  });
  assert.equal(db.store.get('users/u1').accountStatus, 'approved');
  assert.equal(db.store.get('users/u1').statusChangedBy, CHANGED_BY);
  assert.equal(db.store.get('users/u1').statusChangedAt, 'SERVER_TIME');
  assert.equal(db.store.get('users/u1').theme, 'light', 'other profile fields are untouched');
  assert.equal(db.store.get('users/u2').accountStatus, 'approved');
});

test('an account without a profile only gets the claim; no document is created', async () => {
  const auth = fakeAuth(users());
  const db = fakeDb(profiles());
  const result = await runBackfill({ auth, db, apply: true, log: quiet });
  assert.deepEqual(auth.store.get('u4').customClaims, { acct: 'approved' });
  assert.equal(db.store.has('users/u4'), false);
  assert.equal(result.noProfile, 1);
});

test('blocked accounts are never unblocked', async () => {
  const auth = fakeAuth(users());
  const db = fakeDb(profiles());
  const result = await runBackfill({ auth, db, apply: true, log: quiet });
  assert.deepEqual(result.blockedUids, ['u5']);
  assert.deepEqual(auth.store.get('u5').customClaims, { acct: 'blocked' });
  assert.equal(db.store.get('users/u5').accountStatus, 'blocked');
  // A blocked profile status alone is enough.
  assert.equal(planUser({}, { accountStatus: 'blocked' }).action, 'blocked');
});

test('is idempotent: a second run (and a dry run after it) changes nothing', async () => {
  const auth = fakeAuth(users());
  const db = fakeDb(profiles());
  await runBackfill({ auth, db, apply: true, log: quiet });
  const setsAfterFirst = auth.sets.length;
  const commitsAfterFirst = db.commits.length;
  const second = await runBackfill({ auth, db, apply: true, log: quiet });
  assert.equal(second.toChange, 0);
  assert.equal(second.changed, 0);
  assert.equal(auth.sets.length, setsAfterFirst);
  assert.equal(db.commits.length, commitsAfterFirst);
  const verify = await runBackfill({ auth, db, log: quiet });
  assert.equal(verify.toChange, 0);
});

test('re-plans when the profile is written meanwhile', async () => {
  const auth = fakeAuth([{ uid: 'u1', customClaims: {} }]);
  const db = fakeDb({ 'users/u1': { displayName: 'Avery' } });
  // The first read returns an outdated updateTime (as if the profile was written right after),
  // so the first commit is refused with a conflict and the user is read and planned again.
  const getMeta = db.getDocMeta;
  let reads = 0;
  db.getDocMeta = async (path) => {
    const meta = await getMeta(path);
    reads += 1;
    if (reads === 1 && meta) meta.updateTime = 'stale';
    return meta;
  };
  const result = await runBackfill({ auth, db, apply: true, log: quiet });
  assert.equal(result.changed, 1);
  assert.equal(result.toChange, 1);
  assert.equal(db.store.get('users/u1').accountStatus, 'approved');
});

test('planUser covers the cases', () => {
  assert.deepEqual(planUser({}, null), { action: 'change', claim: true, doc: false });
  assert.deepEqual(planUser({ acct: 'approved' }, null), {
    action: 'skip',
    claim: false,
    doc: false,
  });
  assert.deepEqual(planUser({ acct: 'approved' }, {}), {
    action: 'change',
    claim: false,
    doc: true,
  });
  assert.deepEqual(planUser(undefined, { accountStatus: 'approved' }), {
    action: 'change',
    claim: true,
    doc: false,
  });
});

test('options: emulator by default, production with --project', () => {
  const dry = resolveOptions(parseCliArgs([]));
  assert.equal(dry.target, 'emulator');
  assert.equal(dry.apply, false);
  assert.equal(dry.quotaProject, undefined);
  const prod = resolveOptions(parseCliArgs(['--project', 'my-proj-1', '--apply']));
  assert.equal(prod.target, 'production');
  assert.equal(prod.apply, true);
  assert.equal(prod.quotaProject, 'my-proj-1');
  assert.throws(() => resolveOptions(parseCliArgs(['--project', 'Bad_ID'])));
});

test('Auth REST client: endpoints, headers, claim parsing', async () => {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url, init });
    const body = init.body ? JSON.parse(init.body) : null;
    const json = url.includes('batchGet')
      ? {
          users: [
            { localId: 'u1', customAttributes: '{"admin":true}' },
            { localId: 'u2', disabled: true },
          ],
          nextPageToken: 'next',
        }
      : { echo: body };
    return { ok: true, status: 200, json: async () => json };
  };
  const auth = createAuthRest({
    origin: 'https://identitytoolkit.googleapis.com',
    project: 'my-proj-1',
    getToken: () => 'tok',
    quotaProject: 'my-proj-1',
    fetch: fetchStub,
  });
  const page = await auth.listUsers('abc');
  assert.deepEqual(page.users, [
    { uid: 'u1', customClaims: { admin: true }, disabled: false },
    { uid: 'u2', customClaims: {}, disabled: true },
  ]);
  assert.equal(page.nextPageToken, 'next');
  assert.equal(
    calls[0].url,
    'https://identitytoolkit.googleapis.com/v1/projects/my-proj-1/accounts:batchGet?maxResults=1000&nextPageToken=abc',
  );
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
  assert.equal(calls[0].init.headers['x-goog-user-project'], 'my-proj-1');

  await auth.setCustomClaims('u1', { acct: 'approved' });
  assert.equal(
    calls[1].url,
    'https://identitytoolkit.googleapis.com/v1/projects/my-proj-1/accounts:update',
  );
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    localId: 'u1',
    customAttributes: '{"acct":"approved"}',
  });
});
