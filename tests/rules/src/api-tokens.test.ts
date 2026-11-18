import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { USERS, createTestEnv, seedFixture } from './helpers';

/**
 * P8 personal access tokens: `users/{uid}/apiTokens/{tokenId}` is readable by its approved owner and
 * written by nobody; `apiTokenIndex/{hash}` has no rule at all (Functions only, default deny).
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const ME = USERS.member;
const TOKEN = 'token1';
const HASH = 'a'.repeat(64);
const seedTs = Timestamp.fromMillis(1_700_000_000_000);

const tokenData = (overrides: Record<string, unknown> = {}) => ({
  name: 'Shortcuts',
  prefix: 'atrp_abc',
  scopes: ['read'],
  workspaceIds: null,
  createdAt: seedTs,
  expiresAt: seedTs,
  lastUsedAt: null,
  revokedAt: null,
  ...overrides,
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ME, 'apiTokens', TOKEN), tokenData());
    await setDoc(doc(db, 'apiTokenIndex', HASH), { uid: ME, tokenId: TOKEN, expiresAt: seedTs });
  });
});

const as = (uid: string, claims: Record<string, unknown> = {}) =>
  env.authenticatedContext(uid, claims).firestore();
const anon = () => env.unauthenticatedContext().firestore();
type Db = ReturnType<typeof anon>;
const tokenRef = (db: Db, owner: string = ME, id = TOKEN) =>
  doc(db, 'users', owner, 'apiTokens', id);

describe('users/{uid}/apiTokens: the owner', () => {
  it('reads and lists their own tokens', async () => {
    await assertSucceeds(getDoc(tokenRef(as(ME))));
    await assertSucceeds(getDocs(collection(as(ME), 'users', ME, 'apiTokens')));
  });

  it('cannot create, update or delete a token', async () => {
    await assertFails(setDoc(tokenRef(as(ME), ME, 'token2'), tokenData()));
    await assertFails(updateDoc(tokenRef(as(ME)), { revokedAt: seedTs }));
    await assertFails(updateDoc(tokenRef(as(ME)), { scopes: ['read', 'write'] }));
    await assertFails(deleteDoc(tokenRef(as(ME))));
    await assertSucceeds(getDoc(tokenRef(as(ME))));
  });
});

describe('users/{uid}/apiTokens: nobody else', () => {
  const callers: Array<[string, () => Db]> = [
    ['another approved user', () => as(USERS.owner)],
    ['a workspace admin', () => as(USERS.admin)],
    ['a site admin', () => as(USERS.outsider, { admin: true })],
    ['a blocked account', () => as(ME, { acct: 'blocked' })],
    ['a pending account', () => as(ME, { acct: 'pending' })],
    ['a signed-in account without a status', () => as(ME, { acct: undefined })],
    ['a signed-out caller', () => anon()],
  ];

  for (const [label, db] of callers) {
    it(`refuses ${label}: get, list, create, update, delete`, async () => {
      await assertFails(getDoc(tokenRef(db())));
      await assertFails(getDocs(collection(db(), 'users', ME, 'apiTokens')));
      await assertFails(setDoc(tokenRef(db(), ME, 'token2'), tokenData()));
      await assertFails(updateDoc(tokenRef(db()), { revokedAt: seedTs }));
      await assertFails(deleteDoc(tokenRef(db())));
    });
  }

  it('refuses a collection-group query, for the owner too', async () => {
    await assertFails(getDocs(collectionGroup(as(ME), 'apiTokens')));
    await assertFails(getDocs(collectionGroup(as(USERS.outsider, { admin: true }), 'apiTokens')));
    await assertFails(getDocs(collectionGroup(anon(), 'apiTokens')));
  });
});

describe('apiTokenIndex is Functions-only', () => {
  const callers: Array<[string, () => Db]> = [
    ['the person the token belongs to', () => as(ME)],
    ['another approved user', () => as(USERS.owner)],
    ['a site admin', () => as(USERS.outsider, { admin: true })],
    ['a signed-out caller', () => anon()],
  ];

  for (const [label, db] of callers) {
    it(`refuses ${label}: get, list, create, update, delete`, async () => {
      const ref = doc(db(), 'apiTokenIndex', HASH);
      await assertFails(getDoc(ref));
      await assertFails(getDocs(collection(db(), 'apiTokenIndex')));
      await assertFails(setDoc(doc(db(), 'apiTokenIndex', 'b'.repeat(64)), { uid: ME }));
      await assertFails(updateDoc(ref, { uid: USERS.owner }));
      await assertFails(deleteDoc(ref));
    });
  }
});
