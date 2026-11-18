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
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, PRIVATE_BOARD, USERS, boardDoc, createTestEnv, seedFixture } from './helpers';

/**
 * P8 PR 7a incoming incomingHooks: `boards/{boardId}/incomingHooks/{id}` is readable by board owners only
 * (never an editor or viewer) and written by nobody; the top-level `incomingHookIndex/{sha256hex}` has
 * no rule at all (Functions only, default deny).
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const seedTs = Timestamp.fromMillis(1_700_000_000_000);
const HOOK = 'hook1';
/** A private board where `member` is the owner and `owner` (the workspace owner) is only a viewer. */
const OWNED_BY_MEMBER = 'boardOwnedByMember';

const hookData = (overrides: Record<string, unknown> = {}) => ({
  name: 'Form intake',
  enabled: true,
  createdBy: USERS.owner,
  createdAt: seedTs,
  lastUsedAt: null,
  defaultGroupId: null,
  ...overrides,
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(
      doc(db, 'boards', OWNED_BY_MEMBER),
      boardDoc({
        kind: 'private',
        name: 'Member board',
        access: { [USERS.member]: 'owner', [USERS.owner]: 'viewer' },
      }),
    );
    for (const board of [MAIN_BOARD, PRIVATE_BOARD, OWNED_BY_MEMBER]) {
      await setDoc(doc(db, 'boards', board, 'incomingHooks', HOOK), hookData());
    }
    await setDoc(doc(db, 'incomingHookIndex', 'a'.repeat(64)), {
      boardId: MAIN_BOARD,
      hookId: HOOK,
      createdAt: seedTs,
    });
  });
});

const as = (uid: string, claims: Record<string, unknown> = {}) =>
  env.authenticatedContext(uid, claims).firestore();
const anon = () => env.unauthenticatedContext().firestore();
type Db = ReturnType<typeof anon>;
const hookRef = (db: Db, board: string, id = HOOK) => doc(db, 'boards', board, 'incomingHooks', id);

describe('incomingHooks: board owners read', () => {
  it('reads and lists on a main board (workspace owner and admin are board owners there)', async () => {
    for (const uid of [USERS.owner, USERS.admin]) {
      await assertSucceeds(getDoc(hookRef(as(uid), MAIN_BOARD)));
      await assertSucceeds(getDocs(collection(as(uid), 'boards', MAIN_BOARD, 'incomingHooks')));
    }
  });

  it('reads on a private board where the caller has the owner role', async () => {
    await assertSucceeds(getDoc(hookRef(as(USERS.owner), PRIVATE_BOARD)));
    await assertSucceeds(getDoc(hookRef(as(USERS.member), OWNED_BY_MEMBER)));
    await assertSucceeds(
      getDocs(collection(as(USERS.member), 'boards', OWNED_BY_MEMBER, 'incomingHooks')),
    );
  });

  it('can filter the list (a query by field)', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(as(USERS.owner), 'boards', MAIN_BOARD, 'incomingHooks'),
          where('enabled', '==', true),
        ),
      ),
    );
  });
});

describe('incomingHooks: everyone else is refused', () => {
  const callers: Array<[string, string, () => Db]> = [
    ['an editor (workspace member on a main board)', MAIN_BOARD, () => as(USERS.member)],
    ['a viewer (workspace viewer on a main board)', MAIN_BOARD, () => as(USERS.viewer)],
    ['an explicit board viewer', PRIVATE_BOARD, () => as(USERS.member)],
    [
      'a workspace admin without board access to a private board',
      PRIVATE_BOARD,
      () => as(USERS.admin),
    ],
    ['a workspace owner who is only a viewer of the board', OWNED_BY_MEMBER, () => as(USERS.owner)],
    ['a viewer of a private board they are not on', PRIVATE_BOARD, () => as(USERS.viewer)],
    ['a person outside the workspace', MAIN_BOARD, () => as(USERS.outsider)],
    ['a site admin who is not a member', MAIN_BOARD, () => as(USERS.outsider, { admin: true })],
    [
      'a blocked account (an owner otherwise)',
      MAIN_BOARD,
      () => as(USERS.owner, { acct: 'blocked' }),
    ],
    [
      'a pending account (an owner otherwise)',
      MAIN_BOARD,
      () => as(USERS.owner, { acct: 'pending' }),
    ],
    [
      'a signed-in account without a status',
      MAIN_BOARD,
      () => as(USERS.owner, { acct: undefined }),
    ],
    ['a signed-out caller', MAIN_BOARD, () => anon()],
  ];

  for (const [label, board, db] of callers) {
    it(`refuses ${label}: get and list`, async () => {
      await assertFails(getDoc(hookRef(db(), board)));
      await assertFails(getDocs(collection(db(), 'boards', board, 'incomingHooks')));
    });
  }

  it('answers a missing board with a refusal, not an empty list', async () => {
    await assertFails(getDocs(collection(as(USERS.owner), 'boards', 'nope', 'incomingHooks')));
  });
});

describe('incomingHooks: nobody writes, board owners included', () => {
  const owners: Array<[string, () => Db, string]> = [
    ['the workspace owner on a main board', () => as(USERS.owner), MAIN_BOARD],
    ['an explicit board owner', () => as(USERS.member), OWNED_BY_MEMBER],
    ['a site admin', () => as(USERS.outsider, { admin: true }), MAIN_BOARD],
    ['a signed-out caller', () => anon(), MAIN_BOARD],
  ];

  for (const [label, db, board] of owners) {
    it(`refuses ${label}: create, update, delete`, async () => {
      await assertFails(setDoc(hookRef(db(), board, 'hook2'), hookData()));
      await assertFails(updateDoc(hookRef(db(), board), { enabled: false }));
      await assertFails(updateDoc(hookRef(db(), board), { url: 'https://evil.example.com' }));
      await assertFails(deleteDoc(hookRef(db(), board)));
    });
  }

  it('leaves the document unchanged after the refused writes', async () => {
    await assertFails(updateDoc(hookRef(as(USERS.owner), MAIN_BOARD), { enabled: false }));
    const snap = await assertSucceeds(getDoc(hookRef(as(USERS.owner), MAIN_BOARD)));
    if (snap.get('enabled') !== true) throw new Error('document changed');
  });
});

describe('incomingHooks: collection-group queries are refused', () => {
  it('refuses a collection-group query on incomingHooks for everyone', async () => {
    for (const db of [
      as(USERS.owner),
      as(USERS.member),
      as(USERS.outsider, { admin: true }),
      anon(),
    ]) {
      await assertFails(getDocs(collectionGroup(db, 'incomingHooks')));
    }
  });

  it('refuses a collection-group query that filters by the board id', async () => {
    await assertFails(
      getDocs(
        query(collectionGroup(as(USERS.owner), 'incomingHooks'), where('enabled', '==', true)),
      ),
    );
  });
});

describe('incomingHookIndex is Functions-only', () => {
  const callers: Array<[string, () => Db]> = [
    ['the board owner', () => as(USERS.owner)],
    ['an explicit board owner', () => as(USERS.member)],
    ['a site admin', () => as(USERS.outsider, { admin: true })],
    ['a signed-out caller', () => anon()],
  ];
  const ref = (db: Db, id = 'a'.repeat(64)) => doc(db, 'incomingHookIndex', id);

  for (const [label, db] of callers) {
    it(`refuses ${label}: get, list, create, update, delete`, async () => {
      await assertFails(getDoc(ref(db())));
      await assertFails(getDocs(collection(db(), 'incomingHookIndex')));
      await assertFails(
        getDocs(query(collection(db(), 'incomingHookIndex'), where('boardId', '==', MAIN_BOARD))),
      );
      await assertFails(getDocs(collectionGroup(db(), 'incomingHookIndex')));
      await assertFails(setDoc(ref(db(), 'b'.repeat(64)), { boardId: MAIN_BOARD, hookId: HOOK }));
      await assertFails(updateDoc(ref(db()), { hookId: 'other' }));
      await assertFails(deleteDoc(ref(db())));
    });
  }
});
