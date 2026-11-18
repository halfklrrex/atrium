import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
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
 * P8 public API: `apiUsage/{id}` (daily counters), `apiIdempotency/{uid}_{key}` (stored write responses) and `system/apiAudit/entries/{id}` (audit trail) have
 * no rule at all: only Cloud Functions touch them, and every client is refused.
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const ME = USERS.member;

const functionsOnly = {
  apiUsage: { path: ['apiUsage', 'tok1'], data: { day: '2026-11-18', calls: 1, writes: 0 } },
  apiUsageHook: {
    path: ['apiUsage', 'hook_hook1'],
    data: { day: '2026-11-18', calls: 3, writes: 3 },
  },
  apiIdempotency: {
    path: ['apiIdempotency', `${ME}_key1`],
    data: { hash: 'abc', state: 'done', status: 201, body: '{}' },
  },
  apiAudit: {
    path: ['system', 'apiAudit', 'entries', 'e1'],
    data: { kind: 'call', uid: ME, status: 200 },
  },
} as const;

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const { path, data } of Object.values(functionsOnly)) {
      await setDoc(doc(db, path[0], ...path.slice(1)), data);
    }
  });
});

const as = (uid: string, claims: Record<string, unknown> = {}) =>
  env.authenticatedContext(uid, claims).firestore();
const anon = () => env.unauthenticatedContext().firestore();
type Db = ReturnType<typeof anon>;

describe('the API Functions-only collections', () => {
  const callers: Array<[string, () => Db]> = [
    ['the person the counter or entry is about', () => as(ME)],
    ['another approved user', () => as(USERS.owner)],
    ['a workspace admin', () => as(USERS.admin)],
    ['a site admin', () => as(USERS.outsider, { admin: true })],
    ['a blocked account', () => as(ME, { acct: 'blocked' })],
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
    await assertFails(getDocs(collectionGroup(as(ME), 'entries')));
  });
});
