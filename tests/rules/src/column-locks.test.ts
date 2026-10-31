import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  FieldPath,
  arrayRemove,
  arrayUnion,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { USERS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

let env: RulesTestEnvironment;

const LOCKED_BOARD = 'boardLocked';
const LEGACY_BOARD = 'boardLegacyNoLocks';

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
      doc(db, 'boards', LOCKED_BOARD),
      boardDoc({
        columns: [
          { id: 'budget', type: 'numbers', title: 'Budget', position: 'a0', settings: {} },
          { id: 'note', type: 'text', title: 'Note', position: 'a1', settings: {} },
        ],
        subitemColumns: [
          { id: 'sub_cost', type: 'numbers', title: 'Sub Cost', position: 'a0', settings: {} },
          { id: 'sub_note', type: 'text', title: 'Sub Note', position: 'a1', settings: {} },
        ],
        columnLocks: ['budget', 'sub_cost'],
      }),
    );
    await setDoc(
      doc(db, 'boards', LOCKED_BOARD, 'items', 'i1'),
      itemDoc({ values: { budget: 1000, note: 'initial' } }),
    );
    await setDoc(
      doc(db, 'boards', LOCKED_BOARD, 'items', 'sub1'),
      itemDoc({ parentItemId: 'i1', values: { sub_cost: 250, sub_note: 'sub initial' } }),
    );
    // Board with no columnLocks field at all
    const legacy = boardDoc({
      columns: [{ id: 'budget', type: 'numbers', title: 'Budget', position: 'a0', settings: {} }],
    });
    await setDoc(doc(db, 'boards', LEGACY_BOARD), legacy);
    await setDoc(doc(db, 'boards', LEGACY_BOARD, 'items', 'i1'), itemDoc());
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const boardRef = (uid: string, id = LOCKED_BOARD) => doc(as(uid), 'boards', id);
const itemRef = (uid: string, boardId = LOCKED_BOARD, id = 'i1') =>
  doc(as(uid), 'boards', boardId, 'items', id);

const newBoard = (uid: string, overrides: Record<string, unknown> = {}) =>
  boardDoc({
    access: { [uid]: 'owner' },
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

const newItem = (uid: string, overrides: Record<string, unknown> = {}) =>
  itemDoc({
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

const writeCell = (
  uid: string,
  boardId: string,
  itemId: string,
  columnId: string,
  value: unknown,
) =>
  updateDoc(
    itemRef(uid, boardId, itemId),
    new FieldPath('values', columnId),
    value,
    'updatedAt',
    serverTimestamp(),
    'updatedBy',
    uid,
  );

describe('board create and update rules for columnLocks', () => {
  it('allows creating a board when columnLocks is omitted or []', async () => {
    await assertSucceeds(setDoc(boardRef(USERS.member, 'new-omitted'), newBoard(USERS.member)));
    await assertSucceeds(
      setDoc(boardRef(USERS.member, 'new-empty'), newBoard(USERS.member, { columnLocks: [] })),
    );
  });

  it('refuses creating a board with a non-empty or non-list columnLocks', async () => {
    await assertFails(
      setDoc(
        boardRef(USERS.member, 'new-nonempty'),
        newBoard(USERS.member, { columnLocks: ['budget'] }),
      ),
    );
    await assertFails(
      setDoc(boardRef(USERS.member, 'new-null'), newBoard(USERS.member, { columnLocks: null })),
    );
  });

  it('allows board owners to update columnLocks and denies editors', async () => {
    // Editor (workspace member on main board) cannot change columnLocks
    await assertFails(
      updateDoc(boardRef(USERS.member), {
        columnLocks: [],
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
    await assertFails(
      updateDoc(boardRef(USERS.member), {
        columnLocks: arrayUnion('note'),
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );

    // Board owners (explicit owner and workspace admin on main board) can lock/unlock columns
    await assertSucceeds(
      updateDoc(boardRef(USERS.owner), {
        columnLocks: arrayUnion('note'),
        updatedAt: serverTimestamp(),
        updatedBy: USERS.owner,
      }),
    );
    await assertSucceeds(
      updateDoc(boardRef(USERS.admin), {
        columnLocks: arrayRemove('note'),
        updatedAt: serverTimestamp(),
        updatedBy: USERS.admin,
      }),
    );

    // Rejects non-list or > 200 items even for owner
    await assertFails(
      updateDoc(boardRef(USERS.owner), {
        columnLocks: 'not-a-list',
        updatedAt: serverTimestamp(),
        updatedBy: USERS.owner,
      }),
    );
    await assertFails(
      updateDoc(boardRef(USERS.owner), {
        columnLocks: deleteField(),
        updatedAt: serverTimestamp(),
        updatedBy: USERS.owner,
      }),
    );
    const over200 = Array.from({ length: 201 }, (_, i) => `c_${i}`);
    await assertFails(
      updateDoc(boardRef(USERS.owner), {
        columnLocks: over200,
        updatedAt: serverTimestamp(),
        updatedBy: USERS.owner,
      }),
    );
  });
});

describe('item create and update rules for locked columns', () => {
  it('denies an editor from changing a locked column via field-path update or whole values map write', async () => {
    const uid = USERS.member;
    // Field-path write
    await assertFails(writeCell(uid, LOCKED_BOARD, 'i1', 'budget', 9999));
    // Removing a locked key
    await assertFails(writeCell(uid, LOCKED_BOARD, 'i1', 'budget', deleteField()));
    // Whole values map write that alters the locked value
    await assertFails(
      updateDoc(itemRef(uid), {
        values: { budget: 9999, note: 'initial' },
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
    // Whole values map write that removes the locked key
    await assertFails(
      updateDoc(itemRef(uid), {
        values: { note: 'initial' },
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
  });

  it('denies an editor from creating an item with a locked column value', async () => {
    const uid = USERS.member;
    await assertFails(
      setDoc(itemRef(uid, LOCKED_BOARD, 'new1'), newItem(uid, { values: { budget: 500 } })),
    );
    await assertFails(
      setDoc(
        itemRef(uid, LOCKED_BOARD, 'new2'),
        newItem(uid, { values: { budget: null, note: 'ok' } }),
      ),
    );
  });

  it('allows an editor to edit unlocked columns, create items without locked values, and delete items with locked values', async () => {
    const uid = USERS.member;
    // Edit unlocked column via field path
    await assertSucceeds(writeCell(uid, LOCKED_BOARD, 'i1', 'note', 'updated by editor'));
    // Edit unlocked column via whole map when locked value stays identical
    await assertSucceeds(
      updateDoc(itemRef(uid), {
        values: { budget: 1000, note: 'whole map ok' },
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
    // Create item with unlocked column only
    await assertSucceeds(
      setDoc(itemRef(uid, LOCKED_BOARD, 'editor-item'), newItem(uid, { values: { note: 'fine' } })),
    );
    // Delete item that holds locked values
    await assertSucceeds(deleteDoc(itemRef(uid, LOCKED_BOARD, 'i1')));
  });

  it('allows board owners to create items with locked values and edit locked values', async () => {
    for (const uid of [USERS.owner, USERS.admin]) {
      await assertSucceeds(writeCell(uid, LOCKED_BOARD, 'i1', 'budget', 2500));
      await assertSucceeds(
        setDoc(
          itemRef(uid, LOCKED_BOARD, `owner-item-${uid}`),
          newItem(uid, { values: { budget: 5000, note: 'owner created' } }),
        ),
      );
    }
  });

  it('enforces locks on subitemColumns ids the same way', async () => {
    // Editor cannot update or create with locked subitem column `sub_cost`
    await assertFails(writeCell(USERS.member, LOCKED_BOARD, 'sub1', 'sub_cost', 999));
    await assertFails(
      setDoc(
        itemRef(USERS.member, LOCKED_BOARD, 'sub-denied'),
        newItem(USERS.member, { parentItemId: 'i1', values: { sub_cost: 100 } }),
      ),
    );

    // Editor can update and create unlocked subitem column `sub_note`
    await assertSucceeds(writeCell(USERS.member, LOCKED_BOARD, 'sub1', 'sub_note', 'edited sub'));
    await assertSucceeds(
      setDoc(
        itemRef(USERS.member, LOCKED_BOARD, 'sub-allowed'),
        newItem(USERS.member, { parentItemId: 'i1', values: { sub_note: 'ok' } }),
      ),
    );

    // Owner can update and create locked subitem column `sub_cost`
    await assertSucceeds(writeCell(USERS.owner, LOCKED_BOARD, 'sub1', 'sub_cost', 750));
    await assertSucceeds(
      setDoc(
        itemRef(USERS.owner, LOCKED_BOARD, 'sub-owner'),
        newItem(USERS.owner, { parentItemId: 'i1', values: { sub_cost: 300 } }),
      ),
    );
  });

  it('treats a board with no columnLocks field as unlocked', async () => {
    const uid = USERS.member;
    await assertSucceeds(writeCell(uid, LEGACY_BOARD, 'i1', 'budget', 42));
    await assertSucceeds(
      setDoc(itemRef(uid, LEGACY_BOARD, 'legacy-new'), newItem(uid, { values: { budget: 100 } })),
    );
  });
});
