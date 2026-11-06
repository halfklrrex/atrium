import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  query,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, USERS, WS, createTestEnv, seedFixture } from './helpers';

/**
 * ADMIN-1b: `signedIn()` requires the `acct: 'approved'` claim. Pending (no claim), blocked and odd
 * claims are refused everywhere except a person reading their own `users/{uid}` document.
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const seedTs = Timestamp.fromMillis(1_700_000_000_000);

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', USERS.member, 'favorites', 'b1'), {
      boardId: 'b1',
      workspaceId: WS,
      addedAt: seedTs,
      position: 'a0',
    });
    await setDoc(doc(db, 'users', USERS.member, 'notifications', 'n1'), {
      kind: 'mention',
      actorId: USERS.owner,
      actorName: 'Owner',
      actorPhotoURL: null,
      workspaceId: WS,
      boardId: MAIN_BOARD,
      boardName: 'Board',
      itemId: 'i1',
      itemName: 'Item',
      updateId: 'u1',
      replyId: null,
      columnId: null,
      snippet: 'Hello',
      createdAt: seedTs,
      readAt: null,
    });
    await setDoc(doc(db, 'dashboards', 'd1'), {
      workspaceId: WS,
      folderId: null,
      name: 'Overview',
      kind: 'main',
      access: { [USERS.owner]: 'owner' },
      accessUids: [USERS.owner],
      position: 'a0',
      icon: null,
      boardIds: [],
      widgets: [],
      state: 'active',
      deletedAt: null,
      createdAt: seedTs,
      createdBy: USERS.owner,
      updatedAt: seedTs,
    });
  });
});

type Claims = Record<string, unknown>;
const as = (uid: string, claims?: Claims) => env.authenticatedContext(uid, claims).firestore();

const newWorkspace = (uid: string) => ({
  name: 'Mine',
  description: '',
  icon: 'M',
  color: '#00c875',
  ownerId: uid,
  memberIds: [uid],
  roles: { [uid]: 'owner' },
  kind: 'open',
  createdAt: serverTimestamp(),
  createdBy: uid,
  updatedAt: serverTimestamp(),
});

const newFavourite = () => ({
  boardId: 'b2',
  workspaceId: WS,
  addedAt: serverTimestamp(),
  position: 'a1',
});

/** Every non-approved shape the gate must refuse. `undefined` drops the default `acct` claim. */
const NOT_APPROVED: ReadonlyArray<[string, Claims]> = [
  ['missing claim (pending)', { acct: undefined }],
  ['blocked', { acct: 'blocked' }],
  ['pending string', { acct: 'pending' }],
  ['empty string', { acct: '' }],
  ['wrong case', { acct: 'Approved' }],
  ['boolean true', { acct: true }],
  ['array', { acct: ['approved'] }],
  ['admin without acct', { acct: undefined, admin: true }],
  ['blocked admin', { acct: 'blocked', admin: true }],
];

describe('approved account: behaves as before', () => {
  it('reads and updates its own user document', async () => {
    const ref = doc(as(USERS.member), 'users', USERS.member);
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { timezone: 'Europe/Paris' }));
  });

  it('reads workspaces, boards, items, updates and dashboards it has access to', async () => {
    const db = as(USERS.member);
    await assertSucceeds(getDoc(doc(db, 'workspaces', WS)));
    await assertSucceeds(getDoc(doc(db, 'boards', MAIN_BOARD)));
    await assertSucceeds(getDoc(doc(db, 'boards', MAIN_BOARD, 'items', 'i1')));
    await assertSucceeds(getDoc(doc(db, 'boards', MAIN_BOARD, 'items', 'i1', 'updates', 'u1')));
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'boards', MAIN_BOARD, 'items', 'i1', 'updates'),
          where('itemId', '==', 'i1'),
        ),
      ),
    );
    await assertSucceeds(getDoc(doc(as(USERS.owner), 'dashboards', 'd1')));
  });

  it('reads notifications and manages its favourites', async () => {
    const db = as(USERS.member);
    await assertSucceeds(getDoc(doc(db, 'users', USERS.member, 'notifications', 'n1')));
    await assertSucceeds(getDoc(doc(db, 'users', USERS.member, 'favorites', 'b1')));
    await assertSucceeds(setDoc(doc(db, 'users', USERS.member, 'favorites', 'b2'), newFavourite()));
  });

  it('creates a workspace', async () => {
    await assertSucceeds(setDoc(doc(as('fresh'), 'workspaces', 'fresh-ws'), newWorkspace('fresh')));
  });

  it('the admin claim alone grants nothing extra', async () => {
    const db = as(USERS.outsider, { admin: true });
    await assertFails(getDoc(doc(db, 'workspaces', WS)));
    await assertFails(getDoc(doc(db, 'boards', MAIN_BOARD)));
    await assertFails(getDoc(doc(db, 'users', USERS.member)));
  });
});

describe.each(NOT_APPROVED)('account with %s', (_label, claims) => {
  const db = () => as(USERS.member, claims);

  it('can still read its own user document (so the app can show the waiting screen)', async () => {
    await assertSucceeds(getDoc(doc(db(), 'users', USERS.member)));
  });

  it("cannot read another person's user document", async () => {
    await assertFails(getDoc(doc(as(USERS.owner, claims), 'users', USERS.member)));
  });

  it('cannot write its own user document, even a field it could normally change', async () => {
    await assertFails(updateDoc(doc(db(), 'users', USERS.member), { timezone: 'Europe/Paris' }));
    await assertFails(updateDoc(doc(db(), 'users', USERS.member), { accountStatus: 'approved' }));
    await assertFails(deleteDoc(doc(db(), 'users', USERS.member)));
    await assertFails(
      setDoc(doc(as('brand-new', claims), 'users', 'brand-new'), {
        displayName: 'New',
        email: 'new@example.com',
      }),
    );
  });

  it('cannot read workspaces, boards, items, updates or dashboards it is a member of', async () => {
    await assertFails(getDoc(doc(db(), 'workspaces', WS)));
    await assertFails(getDoc(doc(db(), 'boards', MAIN_BOARD)));
    await assertFails(getDoc(doc(db(), 'boards', MAIN_BOARD, 'items', 'i1')));
    await assertFails(getDoc(doc(db(), 'boards', MAIN_BOARD, 'items', 'i1', 'updates', 'u1')));
    await assertFails(
      getDoc(doc(db(), 'boards', MAIN_BOARD, 'items', 'i1', 'updates', 'u1', 'replies', 'r1')),
    );
    await assertFails(getDoc(doc(as(USERS.owner, claims), 'dashboards', 'd1')));
    await assertFails(getDocs(collection(db(), 'workspaces', WS, 'folders')));
  });

  it('cannot write items or workspaces it has the role for', async () => {
    const owner = as(USERS.owner, claims);
    await assertFails(
      updateDoc(doc(owner, 'boards', MAIN_BOARD, 'items', 'i1'), {
        name: 'Renamed',
        updatedAt: serverTimestamp(),
        updatedBy: USERS.owner,
      }),
    );
    await assertFails(updateDoc(doc(owner, 'workspaces', WS), { name: 'Renamed' }));
    await assertFails(
      setDoc(doc(as('fresh', claims), 'workspaces', 'fresh-ws'), newWorkspace('fresh')),
    );
  });

  it('cannot read or write notifications and favourites, even its own', async () => {
    await assertFails(getDoc(doc(db(), 'users', USERS.member, 'notifications', 'n1')));
    await assertFails(getDoc(doc(db(), 'users', USERS.member, 'favorites', 'b1')));
    await assertFails(setDoc(doc(db(), 'users', USERS.member, 'favorites', 'b2'), newFavourite()));
    await assertFails(getDocs(collection(db(), 'users', USERS.member, 'recents')));
  });
});

describe('signed-out user', () => {
  const anon = () => env.unauthenticatedContext().firestore();

  it('is refused everywhere, including the self-read exception', async () => {
    await assertFails(getDoc(doc(anon(), 'users', USERS.member)));
    await assertFails(getDoc(doc(anon(), 'workspaces', WS)));
    await assertFails(getDoc(doc(anon(), 'boards', MAIN_BOARD)));
    await assertFails(getDoc(doc(anon(), 'boards', MAIN_BOARD, 'items', 'i1')));
    await assertFails(getDoc(doc(anon(), 'dashboards', 'd1')));
  });
});

describe('server-only paths stay closed', () => {
  it('refuses an approved admin on the account audit log', async () => {
    const db = as(USERS.owner, { admin: true });
    await assertFails(getDoc(doc(db, 'system', 'accountAudit')));
    await assertFails(setDoc(doc(db, 'system', 'accountAudit', 'entries', 'e1'), { a: 1 }));
  });
});
