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
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, PRIVATE_BOARD, USERS, boardDoc, createTestEnv, seedFixture } from './helpers';

/**
 * P4 activity log. `boards/{id}/activity` is written only by Cloud Functions and read by everyone
 * who can read the board. In the fixture MAIN_BOARD is open to the whole workspace (owner and admin
 * own it, member edits, viewer views) and PRIVATE_BOARD lists only the owner (owner) and the member
 * (viewer); admin and viewer are workspace members who are not on it. Board updates must carry
 * `updatedBy == uid` so the board trigger can attribute column and group changes.
 */

let env: RulesTestEnvironment;
const FORMER = 'former'; // used to be a workspace member; their board access entry is stale
const STALE_PRIVATE = 'boardActivityStale';
const seedTs = Timestamp.fromMillis(1_700_000_000_000);

const entry = (overrides: Record<string, unknown> = {}) => ({
  kind: 'value_changed',
  createdAt: seedTs,
  expiresAt: Timestamp.fromMillis(1_700_000_000_000 + 90 * 86_400_000),
  actorId: USERS.member,
  actorName: 'Avery Quinn',
  actorPhotoUrl: null,
  itemId: 'i1',
  itemName: 'Item',
  parentItemId: null,
  columnId: 'status',
  columnTitle: 'Stage',
  columnType: 'text',
  groupId: null,
  groupTitle: null,
  data: { fromText: 'a', toText: 'b' },
  ...overrides,
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const activityRef = (uid: string, boardId = MAIN_BOARD, id = 'a1') =>
  doc(as(uid), 'boards', boardId, 'activity', id);

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(
      doc(db, 'boards', STALE_PRIVATE),
      boardDoc({
        kind: 'private',
        access: { [USERS.owner]: 'owner', [FORMER]: 'editor' },
      }),
    );
    for (const boardId of [MAIN_BOARD, PRIVATE_BOARD, STALE_PRIVATE]) {
      await setDoc(doc(db, 'boards', boardId, 'activity', 'a1'), entry());
      await setDoc(
        doc(db, 'boards', boardId, 'activity', 'a2'),
        entry({ itemId: 'i2', actorId: USERS.owner }),
      );
    }
  });
});

describe('reading the activity of a main board', () => {
  it('lets the board owner, a workspace admin, an editor and a viewer get and list it', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      await assertSucceeds(getDoc(activityRef(uid)));
      await assertSucceeds(getDocs(collection(as(uid), 'boards', MAIN_BOARD, 'activity')));
    }
  });

  it('allows the queries the web runs: by item, by actor, by column, newest first', async () => {
    const col = collection(as(USERS.viewer), 'boards', MAIN_BOARD, 'activity');
    await assertSucceeds(
      getDocs(query(col, where('itemId', '==', 'i1'), orderBy('createdAt', 'desc'))),
    );
    await assertSucceeds(
      getDocs(
        query(
          col,
          where('actorId', 'in', [USERS.member, USERS.owner]),
          orderBy('createdAt', 'desc'),
        ),
      ),
    );
    await assertSucceeds(
      getDocs(query(col, where('columnId', '==', 'status'), orderBy('createdAt', 'desc'))),
    );
  });

  it('refuses people outside the workspace and signed-out visitors', async () => {
    await assertFails(getDoc(activityRef(USERS.outsider)));
    await assertFails(getDocs(collection(as(USERS.outsider), 'boards', MAIN_BOARD, 'activity')));
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'boards', MAIN_BOARD, 'activity', 'a1')));
  });
});

describe('reading the activity of a private board', () => {
  it('lets the explicit owner and the explicit viewer read it', async () => {
    for (const uid of [USERS.owner, USERS.member]) {
      await assertSucceeds(getDoc(activityRef(uid, PRIVATE_BOARD)));
      await assertSucceeds(getDocs(collection(as(uid), 'boards', PRIVATE_BOARD, 'activity')));
    }
  });

  it('refuses workspace members who are not on the board, even a workspace admin', async () => {
    for (const uid of [USERS.admin, USERS.viewer, USERS.outsider]) {
      await assertFails(getDoc(activityRef(uid, PRIVATE_BOARD)));
      await assertFails(getDocs(collection(as(uid), 'boards', PRIVATE_BOARD, 'activity')));
    }
  });

  it('refuses a removed workspace member whose board entry is stale', async () => {
    await assertFails(getDoc(activityRef(FORMER, STALE_PRIVATE)));
    await assertFails(getDocs(collection(as(FORMER), 'boards', STALE_PRIVATE, 'activity')));
  });
});

describe('writing the activity', () => {
  it('denies every client create, update and delete, board owners included', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer, USERS.outsider]) {
      await assertFails(
        setDoc(activityRef(uid, MAIN_BOARD, `new-${uid}`), entry({ actorId: uid })),
      );
      await assertFails(
        addDoc(collection(as(uid), 'boards', MAIN_BOARD, 'activity'), entry({ actorId: uid })),
      );
      await assertFails(updateDoc(activityRef(uid), { actorName: 'Forged' }));
      await assertFails(deleteDoc(activityRef(uid)));
    }
  });
});

describe('board updates must carry updatedBy', () => {
  const boardRef = (uid: string, boardId = MAIN_BOARD) => doc(as(uid), 'boards', boardId);

  it('accepts an update stamped with the caller', async () => {
    await assertSucceeds(
      updateDoc(boardRef(USERS.member), {
        name: 'Renamed',
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
  });

  it('refuses an update without updatedBy or stamped with someone else', async () => {
    await assertFails(
      updateDoc(boardRef(USERS.member), { name: 'Renamed', updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(boardRef(USERS.member), {
        name: 'Renamed',
        updatedAt: serverTimestamp(),
        updatedBy: USERS.owner,
      }),
    );
    await assertFails(
      updateDoc(boardRef(USERS.member), {
        name: 'Renamed',
        updatedAt: serverTimestamp(),
        updatedBy: null,
      }),
    );
  });

  it('keeps accepting a second update by the same user, but not by another user who omits the stamp', async () => {
    const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: USERS.member });
    await assertSucceeds(updateDoc(boardRef(USERS.member), { name: 'One', ...stamp() }));
    await assertSucceeds(updateDoc(boardRef(USERS.member), { name: 'Two', ...stamp() }));
    // The rule checks the stored value after the write, so an owner who leaves the member's stamp
    // in place is refused: updatedBy would not be theirs.
    await assertFails(
      updateDoc(boardRef(USERS.owner), { name: 'Three', updatedAt: serverTimestamp() }),
    );
  });

  it('lets a board be created with updatedBy == caller, or without it, but not with another uid', async () => {
    const db = as(USERS.member);
    const payload = (overrides: Record<string, unknown> = {}) => ({
      ...boardDoc({
        access: { [USERS.member]: 'owner' },
        createdBy: USERS.member,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      ...overrides,
    });
    await assertSucceeds(setDoc(doc(db, 'boards', 'new-plain'), payload()));
    await assertSucceeds(
      setDoc(doc(db, 'boards', 'new-stamped'), payload({ updatedBy: USERS.member })),
    );
    await assertFails(setDoc(doc(db, 'boards', 'new-forged'), payload({ updatedBy: USERS.owner })));
  });
});
