import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  MAIN_BOARD,
  PRIVATE_BOARD,
  USERS,
  WS,
  boardDoc,
  createTestEnv,
  itemDoc,
  newWorkspacePayload,
  replyDocData,
  seedFixture,
  updateDocData,
} from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('default deny', () => {
  it('denies unauthenticated access everywhere', async () => {
    await assertFails(getDoc(doc(anon(), 'workspaces', WS)));
    await assertFails(getDoc(doc(anon(), 'boards', MAIN_BOARD)));
    await assertFails(getDoc(doc(anon(), 'users', USERS.member)));
  });

  it('denies collections that have no rules yet', async () => {
    await assertFails(getDoc(doc(as(USERS.owner), 'invites', 'x')));
    await assertFails(setDoc(doc(as(USERS.owner), 'invites', 'x'), { a: 1 }));
    await assertFails(getDoc(doc(as(USERS.owner), 'boards', MAIN_BOARD, 'activity', 'x')));
  });
});

describe('users', () => {
  it('lets a user read only their own profile', async () => {
    await assertSucceeds(getDoc(doc(as(USERS.member), 'users', USERS.member)));
    await assertFails(getDoc(doc(as(USERS.owner), 'users', USERS.member)));
  });

  it('lets a user update allowed profile fields', async () => {
    const ref = doc(as(USERS.member), 'users', USERS.member);
    await assertSucceeds(updateDoc(ref, { theme: 'dark', timezone: 'America/New_York' }));
  });

  it('allows lastWorkspaceId only for a workspace the user belongs to', async () => {
    const ref = doc(as(USERS.member), 'users', USERS.member);
    await assertSucceeds(updateDoc(ref, { lastWorkspaceId: WS }));
    await assertFails(updateDoc(ref, { lastWorkspaceId: 'someone-elses' }));
  });

  it('denies changing protected fields, invalid themes, other users and client create/delete', async () => {
    const ref = doc(as(USERS.member), 'users', USERS.member);
    await assertFails(updateDoc(ref, { email: 'evil@example.com' }));
    await assertFails(updateDoc(ref, { displayName: 'Hacker' }));
    await assertFails(updateDoc(ref, { theme: 'neon' }));
    await assertFails(updateDoc(doc(as(USERS.owner), 'users', USERS.member), { theme: 'dark' }));
    await assertFails(deleteDoc(ref));
    await assertFails(
      setDoc(doc(as(USERS.outsider), 'users', USERS.outsider), {
        displayName: 'x',
        email: 'x@example.com',
        photoURL: null,
        timezone: 'UTC',
        locale: 'en',
        lastWorkspaceId: null,
        theme: 'system',
        createdAt: serverTimestamp(),
      }),
    );
  });
});

describe('workspaces', () => {
  it('lets a signed-in user create a workspace where they are the sole owner', async () => {
    const db = as('newbie');
    await assertSucceeds(setDoc(doc(db, 'workspaces', 'mine'), newWorkspacePayload('newbie')));
    await assertSucceeds(addDoc(collection(db, 'workspaces'), newWorkspacePayload('newbie')));
  });

  it('denies unauthenticated create', async () => {
    await assertFails(setDoc(doc(anon(), 'workspaces', 'mine'), newWorkspacePayload('newbie')));
  });

  it('denies forged ownerId, createdBy, memberIds and roles', async () => {
    const db = as('newbie');
    const attempts: Record<string, unknown>[] = [
      { ownerId: USERS.owner },
      { createdBy: USERS.owner },
      { memberIds: ['newbie', USERS.owner] },
      { memberIds: [USERS.owner] },
      { roles: { newbie: 'owner', [USERS.owner]: 'viewer' } },
      { roles: { newbie: 'admin' } },
      { roles: { [USERS.owner]: 'owner' }, memberIds: [USERS.owner], ownerId: USERS.owner },
      { kind: 'public' },
      { color: 'red' },
      { extraField: true },
    ];
    for (const [i, overrides] of attempts.entries()) {
      await assertFails(
        setDoc(doc(db, 'workspaces', `forged${i}`), newWorkspacePayload('newbie', overrides)),
      );
    }
  });

  it('denies a client-supplied createdAt that is not the server time', async () => {
    await assertFails(
      setDoc(
        doc(as('newbie'), 'workspaces', 'mine'),
        newWorkspacePayload('newbie', { createdAt: new Date(2000, 0, 1) }),
      ),
    );
  });

  it('denies reads by outsiders and allows members of any role', async () => {
    await assertFails(getDoc(doc(as(USERS.outsider), 'workspaces', WS)));
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      await assertSucceeds(getDoc(doc(as(uid), 'workspaces', WS)));
    }
  });

  it('only lists workspaces the caller is a member of', async () => {
    const mine = query(
      collection(as(USERS.member), 'workspaces'),
      where('memberIds', 'array-contains', USERS.member),
    );
    await assertSucceeds(getDocs(mine));
    await assertFails(getDocs(collection(as(USERS.member), 'workspaces')));
    const theirs = query(
      collection(as(USERS.outsider), 'workspaces'),
      where('memberIds', 'array-contains', USERS.owner),
    );
    await assertFails(getDocs(theirs));
  });

  it('lets owner and admin update presentation fields', async () => {
    for (const uid of [USERS.owner, USERS.admin]) {
      await assertSucceeds(
        updateDoc(doc(as(uid), 'workspaces', WS), {
          name: `Renamed by ${uid}`,
          color: '#ff0000',
          updatedAt: serverTimestamp(),
        }),
      );
    }
  });

  it('denies viewer, member and outsider updates', async () => {
    for (const uid of [USERS.viewer, USERS.member, USERS.outsider]) {
      await assertFails(
        updateDoc(doc(as(uid), 'workspaces', WS), { name: 'Nope', updatedAt: serverTimestamp() }),
      );
    }
  });

  it('denies privilege escalation through update', async () => {
    const adminRef = doc(as(USERS.admin), 'workspaces', WS);
    const memberRef = doc(as(USERS.member), 'workspaces', WS);
    await assertFails(updateDoc(adminRef, { ownerId: USERS.admin, updatedAt: serverTimestamp() }));
    await assertFails(
      updateDoc(adminRef, { 'roles.admin': 'owner', updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(memberRef, { 'roles.member': 'owner', updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(adminRef, {
        memberIds: [USERS.owner, USERS.admin, 'friend'],
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies invalid field values on update', async () => {
    const ref = doc(as(USERS.owner), 'workspaces', WS);
    await assertFails(updateDoc(ref, { name: '', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { color: 'blue', updatedAt: serverTimestamp() }));
  });

  it('denies client deletes for every role', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer, USERS.outsider]) {
      await assertFails(deleteDoc(doc(as(uid), 'workspaces', WS)));
    }
  });
});

describe('folders', () => {
  const folder = (uid: string, overrides: Record<string, unknown> = {}) => ({
    name: 'New folder',
    parentFolderId: null,
    color: '#ffcb00',
    position: 'a1',
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    ...overrides,
  });

  it('lets any member read and denies outsiders', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      await assertSucceeds(getDoc(doc(as(uid), 'workspaces', WS, 'folders', 'f1')));
    }
    await assertFails(getDoc(doc(as(USERS.outsider), 'workspaces', WS, 'folders', 'f1')));
  });

  it('lets owner and admin create, update and delete', async () => {
    for (const uid of [USERS.owner, USERS.admin]) {
      const db = as(uid);
      await assertSucceeds(setDoc(doc(db, 'workspaces', WS, 'folders', `new-${uid}`), folder(uid)));
      await assertSucceeds(
        updateDoc(doc(db, 'workspaces', WS, 'folders', `new-${uid}`), {
          name: 'Renamed',
          updatedAt: serverTimestamp(),
        }),
      );
      await assertSucceeds(deleteDoc(doc(db, 'workspaces', WS, 'folders', `new-${uid}`)));
    }
  });

  it('denies member, viewer and outsider writes', async () => {
    for (const uid of [USERS.member, USERS.viewer, USERS.outsider]) {
      const db = as(uid);
      await assertFails(setDoc(doc(db, 'workspaces', WS, 'folders', 'x'), folder(uid)));
      await assertFails(
        updateDoc(doc(db, 'workspaces', WS, 'folders', 'f1'), {
          name: 'x',
          updatedAt: serverTimestamp(),
        }),
      );
      await assertFails(deleteDoc(doc(db, 'workspaces', WS, 'folders', 'f1')));
    }
  });

  it('denies forged createdBy and unknown fields', async () => {
    const db = as(USERS.admin);
    await assertFails(
      setDoc(
        doc(db, 'workspaces', WS, 'folders', 'x'),
        folder(USERS.admin, { createdBy: USERS.owner }),
      ),
    );
    await assertFails(
      setDoc(doc(db, 'workspaces', WS, 'folders', 'y'), folder(USERS.admin, { sneaky: true })),
    );
  });
});

describe('boards', () => {
  const newBoard = (uid: string, overrides: Record<string, unknown> = {}) =>
    boardDoc({
      access: { [uid]: 'owner' },
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...overrides,
    });

  it('lets every workspace member read a main board; outsiders cannot', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      await assertSucceeds(getDoc(doc(as(uid), 'boards', MAIN_BOARD)));
    }
    await assertFails(getDoc(doc(as(USERS.outsider), 'boards', MAIN_BOARD)));
  });

  it('limits a private board to its access list', async () => {
    await assertSucceeds(getDoc(doc(as(USERS.owner), 'boards', PRIVATE_BOARD)));
    await assertSucceeds(getDoc(doc(as(USERS.member), 'boards', PRIVATE_BOARD))); // listed viewer
    await assertFails(getDoc(doc(as(USERS.viewer), 'boards', PRIVATE_BOARD))); // member, not listed
    await assertFails(getDoc(doc(as(USERS.admin), 'boards', PRIVATE_BOARD))); // admin does not bypass
    await assertFails(getDoc(doc(as(USERS.outsider), 'boards', PRIVATE_BOARD)));
  });

  it('allows listing main boards of a workspace for members and denies outsiders', async () => {
    const q = (uid: string) =>
      getDocs(
        query(
          collection(as(uid), 'boards'),
          where('workspaceId', '==', WS),
          where('kind', '==', 'main'),
        ),
      );
    await assertSucceeds(q(USERS.viewer));
    await assertFails(q(USERS.outsider));
    // Without the kind constraint the query could return private boards, so it is rejected.
    await assertFails(
      getDocs(query(collection(as(USERS.owner), 'boards'), where('workspaceId', '==', WS))),
    );
  });

  it('lets owner, admin and member create boards with themselves as sole owner', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      await assertSucceeds(setDoc(doc(as(uid), 'boards', `by-${uid}`), newBoard(uid)));
    }
  });

  it('denies board creation by viewers and outsiders', async () => {
    for (const uid of [USERS.viewer, USERS.outsider]) {
      await assertFails(setDoc(doc(as(uid), 'boards', `by-${uid}`), newBoard(uid)));
    }
  });

  it('denies forged access maps, createdBy and lifecycle fields on create', async () => {
    const db = as(USERS.member);
    await assertFails(
      setDoc(
        doc(db, 'boards', 'a'),
        newBoard(USERS.member, { access: { [USERS.member]: 'owner', [USERS.owner]: 'viewer' } }),
      ),
    );
    await assertFails(setDoc(doc(db, 'boards', 'b'), newBoard(USERS.member, { access: {} })));
    await assertFails(
      setDoc(doc(db, 'boards', 'c'), newBoard(USERS.member, { createdBy: USERS.owner })),
    );
    await assertFails(setDoc(doc(db, 'boards', 'd'), newBoard(USERS.member, { state: 'deleted' })));
    await assertFails(
      setDoc(doc(db, 'boards', 'e'), newBoard(USERS.member, { workspaceId: 'other-ws' })),
    );
  });

  it('lets editors change structure but not access, kind or state', async () => {
    const editorDb = as(USERS.member); // member => editor on a main board
    const ref = doc(editorDb, 'boards', MAIN_BOARD);
    await assertSucceeds(
      updateDoc(ref, {
        columns: [{ id: 'c1', type: 'text', title: 'Notes', position: 'a0', settings: {} }],
        name: 'Renamed',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(ref, {
        access: { [USERS.member]: 'owner' },
        accessUids: [USERS.member],
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(ref, { kind: 'private', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { state: 'deleted', updatedAt: serverTimestamp() }));
  });

  it('lets owners (including workspace admins on main boards) manage access and state', async () => {
    for (const uid of [USERS.owner, USERS.admin]) {
      await assertSucceeds(
        updateDoc(doc(as(uid), 'boards', MAIN_BOARD), {
          access: { [USERS.owner]: 'owner', [USERS.viewer]: 'viewer' },
          accessUids: [USERS.owner, USERS.viewer],
          state: 'archived',
          updatedAt: serverTimestamp(),
        }),
      );
    }
  });

  it('denies board updates by viewers and outsiders and immutable-field changes', async () => {
    await assertFails(
      updateDoc(doc(as(USERS.viewer), 'boards', MAIN_BOARD), {
        name: 'x',
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(as(USERS.outsider), 'boards', MAIN_BOARD), {
        name: 'x',
        updatedAt: serverTimestamp(),
      }),
    );
    const owner = doc(as(USERS.owner), 'boards', MAIN_BOARD);
    await assertFails(updateDoc(owner, { workspaceId: 'other', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(owner, { createdBy: USERS.admin, updatedAt: serverTimestamp() }));
  });

  it('denies client deletes', async () => {
    await assertFails(deleteDoc(doc(as(USERS.owner), 'boards', MAIN_BOARD)));
    await assertFails(deleteDoc(doc(as(USERS.admin), 'boards', PRIVATE_BOARD)));
  });
});

describe('items inherit board access', () => {
  const newItem = (uid: string, overrides: Record<string, unknown> = {}) =>
    itemDoc({
      createdBy: uid,
      updatedBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...overrides,
    });
  const itemRef = (uid: string, boardId: string, id = 'i1') =>
    doc(as(uid), 'boards', boardId, 'items', id);

  it('lets any role with board read access read and list items', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      await assertSucceeds(getDoc(itemRef(uid, MAIN_BOARD)));
    }
    await assertSucceeds(
      getDocs(
        query(
          collection(as(USERS.viewer), 'boards', MAIN_BOARD, 'items'),
          where('state', '==', 'active'),
        ),
      ),
    );
  });

  it('denies item reads to outsiders and to members without private-board access', async () => {
    await assertFails(getDoc(itemRef(USERS.outsider, MAIN_BOARD)));
    await assertFails(getDoc(itemRef(USERS.viewer, PRIVATE_BOARD)));
    await assertFails(getDocs(collection(as(USERS.viewer), 'boards', PRIVATE_BOARD, 'items')));
    await assertSucceeds(getDoc(itemRef(USERS.member, PRIVATE_BOARD))); // listed as viewer
  });

  it('lets editors create, update and delete items', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      const ref = itemRef(uid, MAIN_BOARD, `new-${uid}`);
      await assertSucceeds(setDoc(ref, newItem(uid)));
      await assertSucceeds(
        updateDoc(ref, {
          name: 'Edited',
          values: { c1: 'hi' },
          updatedBy: uid,
          updatedAt: serverTimestamp(),
        }),
      );
      await assertSucceeds(deleteDoc(ref));
    }
  });

  it('denies item writes by board viewers and outsiders', async () => {
    for (const uid of [USERS.viewer, USERS.outsider]) {
      await assertFails(setDoc(itemRef(uid, MAIN_BOARD, 'x'), newItem(uid)));
      await assertFails(
        updateDoc(itemRef(uid, MAIN_BOARD), {
          name: 'x',
          updatedBy: uid,
          updatedAt: serverTimestamp(),
        }),
      );
      await assertFails(deleteDoc(itemRef(uid, MAIN_BOARD)));
    }
    // listed viewer on a private board cannot write either
    await assertFails(setDoc(itemRef(USERS.member, PRIVATE_BOARD, 'x'), newItem(USERS.member)));
  });

  it('denies item writes on a private board to members who are not listed', async () => {
    await assertFails(setDoc(itemRef(USERS.admin, PRIVATE_BOARD, 'x'), newItem(USERS.admin)));
  });

  it('denies forged audit fields and malformed items', async () => {
    const uid = USERS.member;
    await assertFails(
      setDoc(itemRef(uid, MAIN_BOARD, 'a'), newItem(uid, { createdBy: USERS.owner })),
    );
    await assertFails(
      setDoc(itemRef(uid, MAIN_BOARD, 'b'), newItem(uid, { updatedBy: USERS.owner })),
    );
    await assertFails(setDoc(itemRef(uid, MAIN_BOARD, 'c'), newItem(uid, { name: '' })));
    await assertFails(setDoc(itemRef(uid, MAIN_BOARD, 'd'), newItem(uid, { state: 'deleted' })));
    await assertFails(setDoc(itemRef(uid, MAIN_BOARD, 'e'), newItem(uid, { rogue: 1 })));
    await assertFails(
      updateDoc(itemRef(uid, MAIN_BOARD), {
        createdBy: uid,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(itemRef(uid, MAIN_BOARD), {
        name: 'x',
        updatedBy: USERS.owner,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('lets editors move the item updatesCount by exactly 1 and nothing else in that write', async () => {
    const ref = (uid: string) => itemRef(uid, MAIN_BOARD, 'i1');
    // The seeded item has no counter: it reads as 0, so the first update brings it to 1.
    await assertSucceeds(updateDoc(ref(USERS.member), { updatesCount: increment(1) }));
    await assertSucceeds(updateDoc(ref(USERS.member), { updatesCount: increment(-1) }));
    // Below zero, jumps and non-integers are refused.
    await assertFails(updateDoc(ref(USERS.member), { updatesCount: increment(-1) }));
    await assertFails(updateDoc(ref(USERS.member), { updatesCount: 5 }));
    await assertFails(updateDoc(ref(USERS.member), { updatesCount: 0.5 }));
    // It cannot ride along with other item fields, and viewers and outsiders cannot move it.
    await assertFails(updateDoc(ref(USERS.member), { updatesCount: increment(1), name: 'x' }));
    await assertFails(updateDoc(ref(USERS.viewer), { updatesCount: increment(1) }));
    await assertFails(updateDoc(ref(USERS.outsider), { updatesCount: increment(1) }));
  });

  it('denies items under a board that does not exist', async () => {
    await assertFails(getDoc(itemRef(USERS.owner, 'ghost-board')));
    await assertFails(setDoc(itemRef(USERS.owner, 'ghost-board', 'x'), newItem(USERS.owner)));
  });
});

describe('updates and replies inherit board access', () => {
  const newUpdate = (uid: string, overrides: Record<string, unknown> = {}) =>
    updateDocData({
      authorId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...overrides,
    });

  const newReply = (uid: string, overrides: Record<string, unknown> = {}) =>
    replyDocData({
      authorId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...overrides,
    });

  const updateRef = (uid: string, boardId: string, itemId = 'i1', updateId = 'u1') =>
    doc(as(uid), 'boards', boardId, 'items', itemId, 'updates', updateId);

  const replyRef = (uid: string, boardId: string, itemId = 'i1', updateId = 'u1', replyId = 'r1') =>
    doc(as(uid), 'boards', boardId, 'items', itemId, 'updates', updateId, 'replies', replyId);

  it('lets any role with board read access read updates and replies', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      await assertSucceeds(getDoc(updateRef(uid, MAIN_BOARD)));
      await assertSucceeds(getDoc(replyRef(uid, MAIN_BOARD)));
    }
  });

  it('denies update reads to outsiders and to members without private-board access', async () => {
    await assertFails(getDoc(updateRef(USERS.outsider, MAIN_BOARD)));
    await assertFails(getDoc(replyRef(USERS.outsider, MAIN_BOARD)));
    await assertFails(getDoc(updateRef(USERS.viewer, PRIVATE_BOARD)));
  });

  it('lets board editors create updates and replies', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      const uRef = updateRef(uid, MAIN_BOARD, 'i1', `new-up-${uid}`);
      await assertSucceeds(setDoc(uRef, newUpdate(uid)));

      const rRef = replyRef(uid, MAIN_BOARD, 'i1', 'u1', `new-rep-${uid}`);
      await assertSucceeds(setDoc(rRef, newReply(uid)));
    }
  });

  it('denies update writes by viewers and outsiders', async () => {
    for (const uid of [USERS.viewer, USERS.outsider]) {
      await assertFails(setDoc(updateRef(uid, MAIN_BOARD, 'i1', 'test-x'), newUpdate(uid)));
      await assertFails(setDoc(replyRef(uid, MAIN_BOARD, 'i1', 'u1', 'test-rx'), newReply(uid)));
    }
  });

  it('lets board editors toggle their own likes, but denies forging other users likes or duplicates', async () => {
    const memberRef = updateRef(USERS.member, MAIN_BOARD, 'i1', 'u1');
    // like own ✓
    await assertSucceeds(updateDoc(memberRef, { likes: [USERS.member] }));
    // unlike own ✓
    await assertSucceeds(updateDoc(memberRef, { likes: [] }));
    // add someone else ✗
    await assertFails(updateDoc(memberRef, { likes: [USERS.owner] }));
    // duplicate in list ✗
    await assertFails(updateDoc(memberRef, { likes: [USERS.member, USERS.member] }));

    // Seed with owner like
    await assertSucceeds(
      updateDoc(updateRef(USERS.owner, MAIN_BOARD, 'i1', 'u1'), { likes: [USERS.owner] }),
    );
    // member cannot remove owner's like ✗
    await assertFails(updateDoc(memberRef, { likes: [] }));
    // member can add own like to existing list ✓
    await assertSucceeds(updateDoc(memberRef, { likes: [USERS.owner, USERS.member] }));
  });

  it('only allows repliesCount to change by exactly ±1 and denies arbitrary jumps', async () => {
    const memberRef = updateRef(USERS.member, MAIN_BOARD, 'i1', 'u1');
    // increment by 1 ✓
    await assertSucceeds(updateDoc(memberRef, { repliesCount: 1 }));
    // decrement by 1 ✓
    await assertSucceeds(updateDoc(memberRef, { repliesCount: 0 }));
    // jump to arbitrary number ✗
    await assertFails(updateDoc(memberRef, { repliesCount: 42 }));
    await assertFails(updateDoc(memberRef, { repliesCount: 2 }));
    await assertFails(updateDoc(memberRef, { repliesCount: -1 }));
  });

  it('lets author edit content or delete update, but denies non-author editor editing content', async () => {
    // author is USERS.owner
    const authorRef = updateRef(USERS.owner, MAIN_BOARD, 'i1', 'u-owner');
    await assertSucceeds(setDoc(authorRef, newUpdate(USERS.owner)));

    // member is editor on MAIN_BOARD, but not author or owner, so member cannot edit content
    const otherEditorRef = updateRef(USERS.member, MAIN_BOARD, 'i1', 'u-owner');
    await assertFails(
      updateDoc(otherEditorRef, { content: 'Edited by member', updatedAt: serverTimestamp() }),
    );

    // author can edit content
    await assertSucceeds(
      updateDoc(authorRef, { content: 'Edited by author', updatedAt: serverTimestamp() }),
    );

    // board owner (admin or owner) CAN edit or delete
    const adminRef = updateRef(USERS.admin, MAIN_BOARD, 'i1', 'u-owner');
    await assertSucceeds(
      updateDoc(adminRef, { content: 'Admin edited', updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(deleteDoc(adminRef));
  });

  it('denies forged authorId, wrong itemId or malformed updates', async () => {
    const uid = USERS.member;
    await assertFails(
      setDoc(updateRef(uid, MAIN_BOARD, 'i1', 'bad-1'), newUpdate(uid, { authorId: USERS.owner })),
    );
    await assertFails(
      setDoc(updateRef(uid, MAIN_BOARD, 'i1', 'bad-2'), newUpdate(uid, { itemId: 'wrong-item' })),
    );
    await assertFails(
      setDoc(updateRef(uid, MAIN_BOARD, 'i1', 'bad-3'), newUpdate(uid, { content: '' })),
    );
  });
});
