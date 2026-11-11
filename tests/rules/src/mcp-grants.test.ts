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
 * OPS4 hosted MCP connector: `users/{uid}/mcpGrants/{grantId}` is readable by its approved owner
 * and written by nobody; `mcpClients`, `mcpAuthRequests`, `mcpTokens`, `mcpUsage` and
 * `system/mcpAudit/entries` have no rule at all (Functions only, default deny).
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const ME = USERS.member;
const GRANT = 'grant1';
const seedTs = Timestamp.fromMillis(1_700_000_000_000);

const grantData = (overrides: Record<string, unknown> = {}) => ({
  clientId: 'client1',
  clientName: 'Claude',
  redirectHost: 'claude.ai',
  scopes: ['atrium:read', 'atrium:write'],
  createdAt: seedTs,
  lastUsedAt: seedTs,
  lastRefreshAt: null,
  revokedAt: null,
  ...overrides,
});

const functionsOnly = {
  mcpClients: { path: ['mcpClients', 'client1'], data: { clientName: 'Claude' } },
  mcpAuthRequests: { path: ['mcpAuthRequests', 'req1'], data: { status: 'pending' } },
  mcpTokens: { path: ['mcpTokens', 'a'.repeat(64)], data: { kind: 'access', uid: ME } },
  mcpUsage: { path: ['mcpUsage', ME], data: { day: '2026-11-11', calls: 1 } },
  mcpAudit: { path: ['system', 'mcpAudit', 'entries', 'e1'], data: { kind: 'tool_call', uid: ME } },
} as const;

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ME, 'mcpGrants', GRANT), grantData());
    for (const { path, data } of Object.values(functionsOnly)) {
      await setDoc(doc(db, path[0], ...path.slice(1)), data);
    }
  });
});

const as = (uid: string, claims: Record<string, unknown> = {}) =>
  env.authenticatedContext(uid, claims).firestore();
const anon = () => env.unauthenticatedContext().firestore();
type Db = ReturnType<typeof anon>;
const grantRef = (db: Db, owner: string = ME, id = GRANT) =>
  doc(db, 'users', owner, 'mcpGrants', id);

describe('users/{uid}/mcpGrants: the owner', () => {
  it('reads and lists their own grants', async () => {
    await assertSucceeds(getDoc(grantRef(as(ME))));
    await assertSucceeds(getDocs(collection(as(ME), 'users', ME, 'mcpGrants')));
  });

  it('cannot create, update or delete a grant', async () => {
    await assertFails(setDoc(grantRef(as(ME), ME, 'grant2'), grantData()));
    await assertFails(updateDoc(grantRef(as(ME)), { revokedAt: seedTs }));
    await assertFails(updateDoc(grantRef(as(ME)), { scopes: ['atrium:read'] }));
    await assertFails(deleteDoc(grantRef(as(ME))));
    await assertSucceeds(getDoc(grantRef(as(ME))));
  });
});

describe('users/{uid}/mcpGrants: nobody else', () => {
  const callers: Array<[string, () => Db]> = [
    ['another approved user', () => as(USERS.owner)],
    ['a workspace admin', () => as(USERS.admin)],
    ['a site admin', () => as(USERS.outsider, { admin: true })],
    ['a blocked account', () => as(ME, { acct: 'blocked' })],
    ['a pending account', () => as(ME, { acct: 'pending' })],
    ['a signed-in account without a status', () => as(ME, { acct: undefined })],
    ['an anonymous caller', () => anon()],
  ];

  for (const [label, db] of callers) {
    it(`refuses ${label}: get, list, create, update, delete`, async () => {
      await assertFails(getDoc(grantRef(db())));
      await assertFails(getDocs(collection(db(), 'users', ME, 'mcpGrants')));
      await assertFails(setDoc(grantRef(db(), ME, 'grant2'), grantData()));
      await assertFails(updateDoc(grantRef(db()), { revokedAt: seedTs }));
      await assertFails(deleteDoc(grantRef(db())));
    });
  }

  it('refuses a collection-group query, for the owner too', async () => {
    await assertFails(getDocs(collectionGroup(as(ME), 'mcpGrants')));
    await assertFails(getDocs(collectionGroup(as(USERS.outsider, { admin: true }), 'mcpGrants')));
    await assertFails(getDocs(collectionGroup(anon(), 'mcpGrants')));
  });
});

describe('the Functions-only collections', () => {
  const callers: Array<[string, () => Db]> = [
    ['the person the document is about', () => as(ME)],
    ['a site admin', () => as(USERS.outsider, { admin: true })],
    ['an anonymous caller', () => anon()],
  ];

  for (const [name, { path, data }] of Object.entries(functionsOnly)) {
    for (const [label, db] of callers) {
      it(`${name}: refuses ${label}: get, list, create, update, delete`, async () => {
        const ref = doc(db(), path[0], ...path.slice(1));
        await assertFails(getDoc(ref));
        await assertFails(getDocs(collection(db(), path[0], ...path.slice(1, -1))));
        await assertFails(setDoc(doc(db(), path[0], ...path.slice(1, -1), 'new'), data));
        await assertFails(updateDoc(ref, { touched: true }));
        await assertFails(deleteDoc(ref));
      });
    }
  }

  it('refuses a collection-group query on the audit entries', async () => {
    await assertFails(getDocs(collectionGroup(as(USERS.outsider, { admin: true }), 'entries')));
  });
});
