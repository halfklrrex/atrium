import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  MAIN_BOARD,
  USERS,
  createTestEnv,
  replyDocData,
  seedFixture,
  updateDocData,
} from './helpers';

/**
 * P4 notifications: `users/{uid}/notifications/{id}` is written only by Cloud Functions; the
 * recipient reads, marks read or unread (`readAt` alone) and deletes. Also covers
 * `users/{uid}.notificationPrefs` and the optional `mentions` list on updates and replies.
 */

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

const notificationData = () => ({
  kind: 'mention',
  actorId: USERS.owner,
  actorName: 'Avery Quinn',
  actorPhotoURL: null,
  workspaceId: 'ws1',
  boardId: MAIN_BOARD,
  boardName: 'Board',
  itemId: 'i1',
  itemName: 'Item',
  updateId: 'u1',
  replyId: null,
  columnId: null,
  snippet: 'Hello @Member',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  readAt: null,
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', USERS.member, 'notifications', 'n1'),
      notificationData(),
    );
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const noteRef = (actor: string, owner: string = USERS.member, id = 'n1') =>
  doc(as(actor), 'users', owner, 'notifications', id);

describe('users/{uid}/notifications', () => {
  it('lets the recipient read and list their own notifications', async () => {
    await assertSucceeds(getDoc(noteRef(USERS.member)));
    await assertSucceeds(
      getDocs(collection(as(USERS.member), 'users', USERS.member, 'notifications')),
    );
  });

  it('refuses reads and lists by anyone else, signed in or not', async () => {
    await assertFails(getDoc(noteRef(USERS.owner)));
    await assertFails(getDocs(collection(as(USERS.owner), 'users', USERS.member, 'notifications')));
    await assertFails(getDoc(doc(anon(), 'users', USERS.member, 'notifications', 'n1')));
  });

  it('refuses create for everyone, including the recipient', async () => {
    await assertFails(setDoc(noteRef(USERS.member, USERS.member, 'n2'), notificationData()));
    await assertFails(setDoc(noteRef(USERS.owner, USERS.member, 'n2'), notificationData()));
    await assertFails(setDoc(noteRef(USERS.owner, USERS.owner, 'n2'), notificationData()));
  });

  it('lets the recipient mark read and unread', async () => {
    const ref = noteRef(USERS.member);
    await assertSucceeds(updateDoc(ref, { readAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { readAt: null }));
  });

  it('refuses a readAt that is not the request time, and any other field', async () => {
    const ref = noteRef(USERS.member);
    await assertFails(updateDoc(ref, { readAt: Timestamp.fromMillis(1_000) }));
    await assertFails(updateDoc(ref, { readAt: true }));
    await assertFails(updateDoc(ref, { snippet: 'edited' }));
    await assertFails(updateDoc(ref, { kind: 'assigned' }));
    await assertFails(updateDoc(ref, { readAt: serverTimestamp(), snippet: 'edited' }));
  });

  it('refuses updates and deletes by anyone but the recipient', async () => {
    await assertFails(updateDoc(noteRef(USERS.owner), { readAt: serverTimestamp() }));
    await assertFails(deleteDoc(noteRef(USERS.owner)));
    await assertFails(deleteDoc(doc(anon(), 'users', USERS.member, 'notifications', 'n1')));
  });

  it('lets the recipient delete their notification', async () => {
    await assertSucceeds(deleteDoc(noteRef(USERS.member)));
  });
});

describe('users/{uid}.notificationPrefs', () => {
  const ref = () => doc(as(USERS.member), 'users', USERS.member);

  it('accepts a complete map of booleans', async () => {
    await assertSucceeds(
      updateDoc(ref(), { notificationPrefs: { assigned: false, reply: true, mention: true } }),
    );
  });

  it('refuses extra or missing keys, non-booleans and a non-map', async () => {
    await assertFails(
      updateDoc(ref(), {
        notificationPrefs: { assigned: true, reply: true, mention: true, email: true },
      }),
    );
    await assertFails(updateDoc(ref(), { notificationPrefs: { assigned: true } }));
    await assertFails(
      updateDoc(ref(), { notificationPrefs: { assigned: 'yes', reply: true, mention: true } }),
    );
    await assertFails(updateDoc(ref(), { notificationPrefs: true }));
  });

  it("refuses another user's prefs", async () => {
    await assertFails(
      updateDoc(doc(as(USERS.owner), 'users', USERS.member), {
        notificationPrefs: { assigned: false, reply: false, mention: false },
      }),
    );
  });
});

describe('mentions on updates and replies', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `user${i}`);
  const updateRef = (id: string) =>
    doc(as(USERS.member), 'boards', MAIN_BOARD, 'items', 'i1', 'updates', id);
  const replyRef = (id: string) =>
    doc(as(USERS.member), 'boards', MAIN_BOARD, 'items', 'i1', 'updates', 'u1', 'replies', id);
  const newUpdate = (mentions?: unknown) => ({
    ...updateDocData({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    ...(mentions === undefined ? {} : { mentions }),
  });
  const newReply = (mentions?: unknown) => ({
    ...replyDocData({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    ...(mentions === undefined ? {} : { mentions }),
  });

  it('accepts an update with up to 20 mentions, or none', async () => {
    await assertSucceeds(setDoc(updateRef('a'), newUpdate()));
    await assertSucceeds(setDoc(updateRef('b'), newUpdate([])));
    await assertSucceeds(setDoc(updateRef('c'), newUpdate(ids(20))));
  });

  it('refuses 21 mentions, duplicates and a non-list on an update', async () => {
    await assertFails(setDoc(updateRef('a'), newUpdate(ids(21))));
    await assertFails(setDoc(updateRef('b'), newUpdate(['user1', 'user1'])));
    await assertFails(setDoc(updateRef('c'), newUpdate('user1')));
  });

  it('accepts a reply with up to 20 mentions and refuses 21 or a non-list', async () => {
    await assertSucceeds(setDoc(replyRef('a'), newReply(ids(20))));
    await assertFails(setDoc(replyRef('b'), newReply(ids(21))));
    await assertFails(setDoc(replyRef('c'), newReply('user1')));
  });

  it('refuses changing mentions on an existing update or reply', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(
        doc(db, 'boards', MAIN_BOARD, 'items', 'i1', 'updates', 'm1'),
        updateDocData({ mentions: ['user1'] }),
      );
      await setDoc(
        doc(db, 'boards', MAIN_BOARD, 'items', 'i1', 'updates', 'u1', 'replies', 'm1'),
        replyDocData({ mentions: ['user1'] }),
      );
    });
    await assertFails(
      updateDoc(updateRef('m1'), { mentions: ['user2'], updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(updateRef('u1'), { mentions: ['user2'], updatedAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(replyRef('m1'), { mentions: [], updatedAt: serverTimestamp() }));
    // Editing the text of a mentioning update leaves the list alone.
    await assertSucceeds(updateDoc(updateRef('m1'), { content: 'edited' }));
  });
});
