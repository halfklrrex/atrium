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
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MAIN_BOARD,
  PRIVATE_BOARD,
  USERS,
  WS,
  boardDoc,
  createTestEnv,
  seedFixture,
  workspaceDoc,
} from './helpers';

/** P1a additions: accessUids, board positions/folders, stale access, favourites and recents. */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const OTHER_WS = 'ws2';
const FORMER = 'former'; // used to be a member of WS; their board `access` entries are stale
const STALE_PRIVATE = 'boardStalePrivate';
const STALE_MAIN = 'boardStaleMain';

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // A second workspace with its own folder, owned by someone who is not in WS.
    await setDoc(
      doc(db, 'workspaces', OTHER_WS),
      workspaceDoc({
        ownerId: 'other-owner',
        memberIds: ['other-owner', USERS.member],
        roles: { 'other-owner': 'owner', [USERS.member]: 'member' },
      }),
    );
    await setDoc(doc(db, 'workspaces', OTHER_WS, 'folders', 'f2'), {
      name: 'Elsewhere',
      parentFolderId: null,
      color: '#ffcb00',
      position: 'a0',
      createdAt: Timestamp.now(),
      createdBy: 'other-owner',
      updatedAt: Timestamp.now(),
    });
    // Boards that still carry access for a user who has since left WS.
    await setDoc(
      doc(db, 'boards', STALE_PRIVATE),
      boardDoc({
        kind: 'private',
        access: { [USERS.owner]: 'owner', [FORMER]: 'editor' },
      }),
    );
    await setDoc(
      doc(db, 'boards', STALE_MAIN),
      boardDoc({ access: { [USERS.owner]: 'owner', [FORMER]: 'owner' } }),
    );
    await setDoc(doc(db, 'boards', STALE_PRIVATE, 'items', 'i1'), {
      name: 'Item',
      groupId: 'g1',
      position: 'a0',
      parentItemId: null,
      values: {},
      state: 'active',
      deletedAt: null,
      createdAt: Timestamp.now(),
      createdBy: USERS.owner,
      updatedAt: Timestamp.now(),
      updatedBy: USERS.owner,
    });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

const newBoard = (uid: string, overrides: Record<string, unknown> = {}) =>
  boardDoc({
    access: { [uid]: 'owner' },
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

describe('board create: accessUids, position, icon', () => {
  it('accepts a well-formed new board', async () => {
    await assertSucceeds(setDoc(doc(as(USERS.member), 'boards', 'ok'), newBoard(USERS.member)));
  });

  it('denies a forged or missing accessUids', async () => {
    const db = as(USERS.member);
    await assertFails(
      setDoc(
        doc(db, 'boards', 'a'),
        newBoard(USERS.member, { accessUids: [USERS.member, USERS.owner] }),
      ),
    );
    await assertFails(
      setDoc(doc(db, 'boards', 'b'), newBoard(USERS.member, { accessUids: [USERS.owner] })),
    );
    await assertFails(setDoc(doc(db, 'boards', 'c'), newBoard(USERS.member, { accessUids: [] })));
    const { accessUids: _omitted, ...withoutAccessUids } = newBoard(USERS.member);
    await assertFails(setDoc(doc(db, 'boards', 'd'), withoutAccessUids));
  });

  it('requires a valid position and a null icon', async () => {
    const db = as(USERS.member);
    await assertFails(setDoc(doc(db, 'boards', 'a'), newBoard(USERS.member, { position: '' })));
    await assertFails(setDoc(doc(db, 'boards', 'b'), newBoard(USERS.member, { position: 5 })));
    await assertFails(
      setDoc(doc(db, 'boards', 'c'), newBoard(USERS.member, { position: 'x'.repeat(65) })),
    );
    await assertFails(setDoc(doc(db, 'boards', 'd'), newBoard(USERS.member, { icon: 'x' })));
  });

  it('only allows creating into a folder that exists in the same workspace', async () => {
    const db = as(USERS.member);
    await assertSucceeds(
      setDoc(doc(db, 'boards', 'a'), newBoard(USERS.member, { folderId: 'f1' })),
    );
    await assertFails(
      setDoc(doc(db, 'boards', 'b'), newBoard(USERS.member, { folderId: 'missing' })),
    );
    // f2 exists, but in another workspace
    await assertFails(setDoc(doc(db, 'boards', 'c'), newBoard(USERS.member, { folderId: 'f2' })));
  });
});

describe('board update: accessUids invariant, position, folderId', () => {
  const ownerRef = () => doc(as(USERS.owner), 'boards', PRIVATE_BOARD);

  // `access`, `accessUids` and `kind` are written only by the P4b callables (Admin SDK), so even a
  // consistent change by a board owner is refused. The accessUids invariant still guards the shape.
  it('denies an owner changing access, with or without a matching accessUids', async () => {
    await assertFails(
      updateDoc(ownerRef(), {
        access: { [USERS.owner]: 'owner', [USERS.viewer]: 'editor' },
        accessUids: [USERS.owner, USERS.viewer],
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(ownerRef(), {
        access: { [USERS.owner]: 'owner', [USERS.member]: 'editor' },
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies access changes that leave accessUids stale or forged', async () => {
    await assertFails(
      updateDoc(ownerRef(), {
        access: { [USERS.owner]: 'owner', [USERS.viewer]: 'viewer' },
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(ownerRef(), {
        accessUids: [USERS.owner, USERS.viewer],
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(ownerRef(), {
        access: { [USERS.owner]: 'owner', [USERS.member]: 'viewer' },
        accessUids: [USERS.owner, USERS.member, USERS.member],
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies an editor rewriting access even when accessUids stays consistent', async () => {
    // member is an editor on the main board
    await assertFails(
      updateDoc(doc(as(USERS.member), 'boards', MAIN_BOARD), {
        access: { [USERS.owner]: 'owner', [USERS.member]: 'owner' },
        accessUids: [USERS.owner, USERS.member],
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('lets editors move a board (position, folderId) within the workspace', async () => {
    const ref = doc(as(USERS.member), 'boards', MAIN_BOARD);
    await assertSucceeds(updateDoc(ref, { position: 'a1', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { folderId: 'f1', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { folderId: null, updatedAt: serverTimestamp() }));
  });

  it('denies moving a board into a folder of another workspace or a missing folder', async () => {
    const ref = doc(as(USERS.member), 'boards', MAIN_BOARD);
    await assertFails(updateDoc(ref, { folderId: 'f2', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { folderId: 'missing', updatedAt: serverTimestamp() }));
  });

  it('denies an invalid position and any icon change', async () => {
    const ref = doc(as(USERS.owner), 'boards', MAIN_BOARD);
    await assertFails(updateDoc(ref, { position: '', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { position: 7, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { icon: 'x', updatedAt: serverTimestamp() }));
  });

  it('lets an owner archive and restore a board (undo) but not an editor', async () => {
    const ownerBoard = doc(as(USERS.owner), 'boards', MAIN_BOARD);
    await assertSucceeds(
      updateDoc(ownerBoard, {
        state: 'archived',
        deletedAt: null,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(ownerBoard, { state: 'active', deletedAt: null, updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(as(USERS.member), 'boards', MAIN_BOARD), {
        state: 'deleted',
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('listing boards through accessUids', () => {
  const mine = (uid: string, ws = WS) =>
    getDocs(
      query(
        collection(as(uid), 'boards'),
        where('workspaceId', '==', ws),
        where('accessUids', 'array-contains', uid),
      ),
    );

  it('lists a private board for a user who has access, and only those boards', async () => {
    const snap = await assertSucceeds(mine(USERS.member));
    expect(snap.docs.map((d) => d.id)).toEqual([PRIVATE_BOARD]);
    const ownerSnap = await assertSucceeds(mine(USERS.owner));
    expect(ownerSnap.docs.map((d) => d.id).sort()).toEqual(
      [MAIN_BOARD, PRIVATE_BOARD, STALE_MAIN, STALE_PRIVATE].sort(),
    );
  });

  it('returns nothing (but is allowed) for a member who is on no board', async () => {
    const snap = await assertSucceeds(mine(USERS.viewer));
    expect(snap.empty).toBe(true);
  });

  it("denies querying someone else's accessUids and unconstrained workspace queries", async () => {
    await assertFails(
      getDocs(
        query(
          collection(as(USERS.member), 'boards'),
          where('workspaceId', '==', WS),
          where('accessUids', 'array-contains', USERS.owner),
        ),
      ),
    );
    await assertFails(
      getDocs(query(collection(as(USERS.member), 'boards'), where('workspaceId', '==', WS))),
    );
  });

  it('denies listing for outsiders and for users removed from the workspace', async () => {
    await assertFails(mine(USERS.outsider));
    await assertFails(mine(FORMER));
  });

  it('still lists main boards of the workspace for members (the other half of the merge)', async () => {
    const snap = await assertSucceeds(
      getDocs(
        query(
          collection(as(USERS.viewer), 'boards'),
          where('workspaceId', '==', WS),
          where('kind', '==', 'main'),
        ),
      ),
    );
    expect(snap.docs.map((d) => d.id)).toContain(MAIN_BOARD);
  });
});

describe('stale board access after leaving the workspace', () => {
  it('denies reads of private and main boards through access alone', async () => {
    await assertFails(getDoc(doc(as(FORMER), 'boards', STALE_PRIVATE)));
    await assertFails(getDoc(doc(as(FORMER), 'boards', STALE_MAIN)));
  });

  it('denies item reads and board writes', async () => {
    await assertFails(getDoc(doc(as(FORMER), 'boards', STALE_PRIVATE, 'items', 'i1')));
    await assertFails(
      updateDoc(doc(as(FORMER), 'boards', STALE_MAIN), {
        name: 'Hijacked',
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('keeps access for current members', async () => {
    await assertSucceeds(getDoc(doc(as(USERS.owner), 'boards', STALE_PRIVATE)));
  });
});

describe('users/{uid}/favorites', () => {
  const fav = (uid: string, boardId = 'b1', overrides: Record<string, unknown> = {}) => ({
    boardId,
    workspaceId: WS,
    addedAt: serverTimestamp(),
    position: 'a0',
    ...overrides,
  });
  const ref = (actor: string, owner: string, boardId = 'b1') =>
    doc(as(actor), 'users', owner, 'favorites', boardId);

  it('lets a user create, read, reorder and delete their own favourites', async () => {
    await assertSucceeds(setDoc(ref('u1', 'u1'), fav('u1')));
    await assertSucceeds(getDoc(ref('u1', 'u1')));
    await assertSucceeds(updateDoc(ref('u1', 'u1'), { position: 'a1' }));
    await assertSucceeds(deleteDoc(ref('u1', 'u1')));
  });

  it("denies other users and anonymous access to someone else's favourites", async () => {
    await assertSucceeds(setDoc(ref('u1', 'u1'), fav('u1')));
    await assertFails(getDoc(ref('u2', 'u1')));
    await assertFails(setDoc(ref('u2', 'u1', 'b2'), fav('u2', 'b2')));
    await assertFails(updateDoc(ref('u2', 'u1'), { position: 'a9' }));
    await assertFails(deleteDoc(ref('u2', 'u1')));
    await assertFails(
      getDoc(doc(env.unauthenticatedContext().firestore(), 'users', 'u1', 'favorites', 'b1')),
    );
  });

  it('validates keys and types', async () => {
    await assertFails(setDoc(ref('u1', 'u1', 'b1'), fav('u1', 'other-board')));
    await assertFails(setDoc(ref('u1', 'u1'), fav('u1', 'b1', { extra: true })));
    await assertFails(setDoc(ref('u1', 'u1'), fav('u1', 'b1', { position: '' })));
    await assertFails(setDoc(ref('u1', 'u1'), fav('u1', 'b1', { workspaceId: 42 })));
    await assertFails(
      setDoc(ref('u1', 'u1'), fav('u1', 'b1', { addedAt: Timestamp.fromMillis(1) })),
    );
    const { position: _p, ...noPosition } = fav('u1');
    await assertFails(setDoc(ref('u1', 'u1'), noPosition));
  });

  it('only lets an update change position', async () => {
    await assertSucceeds(setDoc(ref('u1', 'u1'), fav('u1')));
    await assertFails(updateDoc(ref('u1', 'u1'), { workspaceId: 'elsewhere' }));
    await assertFails(updateDoc(ref('u1', 'u1'), { addedAt: serverTimestamp() }));
  });
});

describe('users/{uid}/recents', () => {
  const recent = (boardId = 'b1', overrides: Record<string, unknown> = {}) => ({
    boardId,
    workspaceId: WS,
    visitedAt: serverTimestamp(),
    ...overrides,
  });
  const ref = (actor: string, owner: string, boardId = 'b1') =>
    doc(as(actor), 'users', owner, 'recents', boardId);

  it('lets a user record visits (create, then refresh) and read them back', async () => {
    await assertSucceeds(setDoc(ref('u1', 'u1'), recent()));
    await assertSucceeds(setDoc(ref('u1', 'u1'), recent()));
    await assertSucceeds(getDoc(ref('u1', 'u1')));
    await assertSucceeds(getDocs(collection(as('u1'), 'users', 'u1', 'recents')));
    await assertSucceeds(deleteDoc(ref('u1', 'u1')));
  });

  it('denies other users', async () => {
    await assertSucceeds(setDoc(ref('u1', 'u1'), recent()));
    await assertFails(getDoc(ref('u2', 'u1')));
    await assertFails(setDoc(ref('u2', 'u1', 'b2'), recent('b2')));
    await assertFails(deleteDoc(ref('u2', 'u1')));
    await assertFails(getDocs(collection(as('u2'), 'users', 'u1', 'recents')));
  });

  it('validates keys, ids and the server timestamp', async () => {
    await assertFails(setDoc(ref('u1', 'u1', 'b1'), recent('other')));
    await assertFails(setDoc(ref('u1', 'u1'), recent('b1', { extra: 1 })));
    await assertFails(setDoc(ref('u1', 'u1'), recent('b1', { workspaceId: '' })));
    await assertFails(
      setDoc(ref('u1', 'u1'), recent('b1', { visitedAt: Timestamp.fromMillis(1) })),
    );
  });
});
