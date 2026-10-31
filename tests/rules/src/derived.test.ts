import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  FieldPath,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { USERS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * FW1: derived columns store no value. `boards/{id}.derivedColumnIds` is maintained only by the
 * onBoardColumnsWritten Cloud Function (the Admin SDK bypasses rules); clients can neither change it
 * nor write `values.<derivedColumnId>`.
 */

let env: RulesTestEnvironment;

/** A board whose `calc` column is derived, and a legacy board that has no such field at all. */
const DERIVED_BOARD = 'boardDerived';
const LEGACY_BOARD = 'boardLegacy';

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
      doc(db, 'boards', DERIVED_BOARD),
      boardDoc({
        columns: [
          { id: 'calc', type: 'formula', title: 'Calc', position: 'a0', settings: {} },
          { id: 'note', type: 'text', title: 'Note', position: 'a1', settings: {} },
        ],
        derivedColumnIds: ['calc'],
      }),
    );
    await setDoc(
      doc(db, 'boards', DERIVED_BOARD, 'items', 'i1'),
      // `calc` holds a stale value from before the column became derived.
      itemDoc({ values: { calc: 'stale', note: 'hello' } }),
    );
    const { derivedColumnIds: _unused, ...legacy } = boardDoc();
    await setDoc(doc(db, 'boards', LEGACY_BOARD), legacy);
    await setDoc(doc(db, 'boards', LEGACY_BOARD, 'items', 'i1'), itemDoc());
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const boardRef = (uid: string, id = DERIVED_BOARD) => doc(as(uid), 'boards', id);
const itemRef = (uid: string, boardId = DERIVED_BOARD, id = 'i1') =>
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

/** Field-path cell write with the audit fields, as the board table sends it. */
const writeCell = (uid: string, boardId: string, columnId: string, value: unknown) =>
  updateDoc(
    itemRef(uid, boardId),
    new FieldPath('values', columnId),
    value,
    'updatedAt',
    serverTimestamp(),
    'updatedBy',
    uid,
  );

describe('board create requires derivedColumnIds == []', () => {
  it('accepts an empty list', async () => {
    await assertSucceeds(setDoc(boardRef(USERS.member, 'new-ok'), newBoard(USERS.member)));
  });

  it('rejects a missing field and any non-empty list', async () => {
    const { derivedColumnIds: _unused, ...withoutField } = newBoard(USERS.member);
    await assertFails(setDoc(boardRef(USERS.member, 'new-missing'), withoutField));
    await assertFails(
      setDoc(
        boardRef(USERS.member, 'new-forged'),
        newBoard(USERS.member, { derivedColumnIds: ['calc'] }),
      ),
    );
    await assertFails(
      setDoc(
        boardRef(USERS.member, 'new-null'),
        newBoard(USERS.member, { derivedColumnIds: null }),
      ),
    );
  });
});

describe('clients cannot change derivedColumnIds', () => {
  it('denies every change, including by the board owner', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      await assertFails(
        updateDoc(boardRef(uid), {
          derivedColumnIds: [],
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        }),
      );
      await assertFails(
        updateDoc(boardRef(uid), {
          derivedColumnIds: ['calc', 'note'],
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        }),
      );
      await assertFails(
        updateDoc(boardRef(uid), {
          derivedColumnIds: deleteField(),
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        }),
      );
    }
  });

  it('denies adding the field to a legacy board', async () => {
    await assertFails(
      updateDoc(boardRef(USERS.owner, LEGACY_BOARD), {
        derivedColumnIds: ['x'],
        updatedAt: serverTimestamp(),
        updatedBy: USERS.owner,
      }),
    );
  });

  it('still lets an editor change the columns without touching the field', async () => {
    await assertSucceeds(
      updateDoc(boardRef(USERS.member), {
        columns: [
          { id: 'calc', type: 'formula', title: 'Calc', position: 'a0', settings: {} },
          { id: 'note', type: 'text', title: 'Notes', position: 'a1', settings: {} },
          { id: 'extra', type: 'formula', title: 'Extra', position: 'a2', settings: {} },
        ],
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
  });
});

describe('items: no values for derived columns', () => {
  it('denies creating an item with a derived value', async () => {
    const uid = USERS.member;
    await assertFails(
      setDoc(itemRef(uid, DERIVED_BOARD, 'n1'), newItem(uid, { values: { calc: 42 } })),
    );
    await assertFails(
      setDoc(itemRef(uid, DERIVED_BOARD, 'n2'), newItem(uid, { values: { calc: null } })),
    );
    await assertFails(
      setDoc(itemRef(uid, DERIVED_BOARD, 'n3'), newItem(uid, { values: { note: 'x', calc: 1 } })),
    );
  });

  it('lets an editor create an item with normal values', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      await assertSucceeds(
        setDoc(itemRef(uid, DERIVED_BOARD, `ok-${uid}`), newItem(uid, { values: { note: 'hi' } })),
      );
    }
    await assertSucceeds(
      setDoc(itemRef(USERS.member, DERIVED_BOARD, 'empty'), newItem(USERS.member)),
    );
  });

  it('denies updating a derived value through a field path or the whole map', async () => {
    const uid = USERS.member;
    await assertFails(writeCell(uid, DERIVED_BOARD, 'calc', 'hack'));
    await assertFails(writeCell(uid, DERIVED_BOARD, 'calc', { nested: 1 }));
    await assertFails(
      updateDoc(itemRef(uid), {
        values: { calc: 'hack', note: 'hello' },
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
  });

  it('denies adding or removing a derived key', async () => {
    const uid = USERS.member;
    await assertFails(writeCell(uid, DERIVED_BOARD, 'calc', deleteField()));
    await assertFails(
      updateDoc(itemRef(uid), {
        values: { note: 'hello' },
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
  });

  it('lets an editor still write normal cells, even next to a stale derived value', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      await assertSucceeds(writeCell(uid, DERIVED_BOARD, 'note', `by ${uid}`));
    }
    await assertSucceeds(writeCell(USERS.member, DERIVED_BOARD, 'note', deleteField()));
    // Rewriting the whole map with the stale derived value left as it is is not a change to it.
    await assertSucceeds(
      updateDoc(itemRef(USERS.member), {
        values: { calc: 'stale', note: 'again' },
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
  });

  it('refuses a whole batch when one write touches a derived value', async () => {
    const uid = USERS.member;
    const db = as(uid);
    const batch = writeBatch(db);
    batch.set(doc(db, 'boards', DERIVED_BOARD, 'items', 'b1'), newItem(uid));
    batch.set(
      doc(db, 'boards', DERIVED_BOARD, 'items', 'b2'),
      newItem(uid, { values: { calc: 1 } }),
    );
    await assertFails(batch.commit());
  });

  it('keeps viewers and outsiders out as before', async () => {
    for (const uid of [USERS.viewer, USERS.outsider]) {
      await assertFails(writeCell(uid, DERIVED_BOARD, 'note', 'x'));
    }
  });
});

describe('legacy boards without derivedColumnIds', () => {
  it('treat the list as empty: any value can be written', async () => {
    const uid = USERS.member;
    await assertSucceeds(writeCell(uid, LEGACY_BOARD, 'calc', 'anything'));
    await assertSucceeds(
      setDoc(itemRef(uid, LEGACY_BOARD, 'n1'), newItem(uid, { values: { calc: 1, note: 'x' } })),
    );
  });

  it('can still be edited by an editor', async () => {
    await assertSucceeds(
      updateDoc(boardRef(USERS.member, LEGACY_BOARD), {
        name: 'Renamed',
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
  });
});
