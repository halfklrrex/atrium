import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  FieldPath,
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { USERS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * FW2: server-managed columns (time tracking, files, buttons) are written only by Cloud Functions
 * through the Admin SDK, which bypasses rules. `boards/{id}.serverManagedColumnIds` is maintained
 * only by the onBoardColumnsWritten function; clients can neither change it nor write
 * `values.<serverManagedColumnId>`. Also: `boards/{id}/activity/**` is Functions-only.
 */

let env: RulesTestEnvironment;

/** `timer` and `files` are server-managed, `calc` is derived, `note` is ordinary. */
const MANAGED_BOARD = 'boardManaged';
/** An FW1-era board: has `derivedColumnIds` but not `serverManagedColumnIds`. */
const FW1_BOARD = 'boardFw1';
/** A board from before FW1: neither field. */
const LEGACY_BOARD = 'boardLegacy';

const columns = [
  { id: 'timer', type: 'time_tracking', title: 'Timer', position: 'a0', settings: {} },
  { id: 'files', type: 'files', title: 'Files', position: 'a1', settings: {} },
  { id: 'calc', type: 'formula', title: 'Calc', position: 'a2', settings: {} },
  { id: 'note', type: 'text', title: 'Note', position: 'a3', settings: {} },
];

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
      doc(db, 'boards', MANAGED_BOARD),
      boardDoc({
        columns,
        derivedColumnIds: ['calc'],
        serverManagedColumnIds: ['files', 'timer'],
      }),
    );
    await setDoc(
      doc(db, 'boards', MANAGED_BOARD, 'items', 'i1'),
      // `timer` and `files` hold what the Cloud Functions wrote.
      itemDoc({ values: { timer: { running: false }, files: [{ name: 'a.png' }], note: 'hello' } }),
    );
    await setDoc(doc(db, 'boards', MANAGED_BOARD, 'activity', 'a1'), {
      type: 'button_click',
      actorId: USERS.owner,
    });
    const { serverManagedColumnIds: _managed, ...fw1 } = boardDoc({ columns });
    await setDoc(doc(db, 'boards', FW1_BOARD), fw1);
    await setDoc(doc(db, 'boards', FW1_BOARD, 'items', 'i1'), itemDoc());
    const { derivedColumnIds: _derived, serverManagedColumnIds: _m, ...legacy } = boardDoc();
    await setDoc(doc(db, 'boards', LEGACY_BOARD), legacy);
    await setDoc(doc(db, 'boards', LEGACY_BOARD, 'items', 'i1'), itemDoc());
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const boardRef = (uid: string, id = MANAGED_BOARD) => doc(as(uid), 'boards', id);
const itemRef = (uid: string, boardId = MANAGED_BOARD, id = 'i1') =>
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

describe('board create requires serverManagedColumnIds == []', () => {
  it('accepts an empty list', async () => {
    await assertSucceeds(setDoc(boardRef(USERS.member, 'new-ok'), newBoard(USERS.member)));
  });

  it('rejects a missing field and any non-empty or malformed value', async () => {
    const { serverManagedColumnIds: _unused, ...withoutField } = newBoard(USERS.member);
    await assertFails(setDoc(boardRef(USERS.member, 'new-missing'), withoutField));
    await assertFails(
      setDoc(
        boardRef(USERS.member, 'new-forged'),
        newBoard(USERS.member, { serverManagedColumnIds: ['timer'] }),
      ),
    );
    await assertFails(
      setDoc(
        boardRef(USERS.member, 'new-null'),
        newBoard(USERS.member, { serverManagedColumnIds: null }),
      ),
    );
  });
});

describe('clients cannot change serverManagedColumnIds', () => {
  it('denies every change, including by the board owner', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      await assertFails(
        updateDoc(boardRef(uid), {
          serverManagedColumnIds: [],
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        }),
      );
      await assertFails(
        updateDoc(boardRef(uid), {
          serverManagedColumnIds: ['files', 'timer', 'note'],
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        }),
      );
      await assertFails(
        updateDoc(boardRef(uid), {
          serverManagedColumnIds: deleteField(),
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        }),
      );
    }
  });

  it('denies adding the field to an FW1-era or legacy board', async () => {
    for (const id of [FW1_BOARD, LEGACY_BOARD]) {
      await assertFails(
        updateDoc(boardRef(USERS.owner, id), {
          serverManagedColumnIds: ['x'],
          updatedAt: serverTimestamp(),
          updatedBy: USERS.owner,
        }),
      );
    }
  });

  it('still denies changing derivedColumnIds (FW1) and lets editors change columns', async () => {
    await assertFails(
      updateDoc(boardRef(USERS.owner), {
        derivedColumnIds: [],
        updatedAt: serverTimestamp(),
        updatedBy: USERS.owner,
      }),
    );
    await assertSucceeds(
      updateDoc(boardRef(USERS.member), {
        columns: [
          ...columns,
          { id: 'extra', type: 'files', title: 'More', position: 'a4', settings: {} },
        ],
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
  });
});

describe('items: no client values for server-managed columns', () => {
  it('denies creating an item with a server-managed value, null included', async () => {
    const uid = USERS.member;
    await assertFails(
      setDoc(itemRef(uid, MANAGED_BOARD, 'n1'), newItem(uid, { values: { timer: { x: 1 } } })),
    );
    await assertFails(
      setDoc(itemRef(uid, MANAGED_BOARD, 'n2'), newItem(uid, { values: { files: null } })),
    );
    await assertFails(
      setDoc(
        itemRef(uid, MANAGED_BOARD, 'n3'),
        newItem(uid, { values: { note: 'x', files: [{ name: 'forged.png' }] } }),
      ),
    );
  });

  it("denies a forged files cell that points at another board's Storage object", async () => {
    const uid = USERS.member;
    const forged = {
      files: [
        {
          id: 'f1',
          name: 'secret.pdf',
          storagePath: 'boards/otherBoard/items/otherItem/files/f1',
          size: 1,
          mimeType: 'application/pdf',
          uploadedAt: '2026-10-25T00:00:00.000Z',
          uploadedBy: uid,
        },
      ],
    };
    // Field-path update, whole-map update and item create all carry the forged cell.
    await assertFails(writeCell(uid, MANAGED_BOARD, 'files', forged));
    await assertFails(
      updateDoc(itemRef(uid), {
        values: { timer: { running: false }, files: forged, note: 'hello' },
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
    await assertFails(
      setDoc(itemRef(uid, MANAGED_BOARD, 'forge1'), newItem(uid, { values: { files: forged } })),
    );
  });

  it('still denies creating an item with a derived value on the same board', async () => {
    const uid = USERS.member;
    await assertFails(
      setDoc(itemRef(uid, MANAGED_BOARD, 'n4'), newItem(uid, { values: { calc: 1 } })),
    );
  });

  it('lets an editor create an item with normal values', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      await assertSucceeds(
        setDoc(itemRef(uid, MANAGED_BOARD, `ok-${uid}`), newItem(uid, { values: { note: 'hi' } })),
      );
    }
    await assertSucceeds(
      setDoc(itemRef(USERS.member, MANAGED_BOARD, 'empty'), newItem(USERS.member)),
    );
  });

  it('denies updating a server-managed value through a field path or the whole map', async () => {
    const uid = USERS.member;
    await assertFails(writeCell(uid, MANAGED_BOARD, 'timer', { running: true }));
    await assertFails(writeCell(uid, MANAGED_BOARD, 'files', []));
    await assertFails(writeCell(uid, MANAGED_BOARD, 'timer', { nested: { deep: 1 } }));
    await assertFails(
      updateDoc(itemRef(uid), {
        values: { timer: { running: true }, files: [{ name: 'a.png' }], note: 'hello' },
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
  });

  it('denies adding or removing a server-managed key', async () => {
    const uid = USERS.member;
    await assertFails(writeCell(uid, MANAGED_BOARD, 'timer', deleteField()));
    await assertFails(
      updateDoc(itemRef(uid), {
        values: { files: [{ name: 'a.png' }], note: 'hello' },
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
  });

  it('lets an editor still write normal cells next to server-managed ones', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      await assertSucceeds(writeCell(uid, MANAGED_BOARD, 'note', `by ${uid}`));
    }
    await assertSucceeds(writeCell(USERS.member, MANAGED_BOARD, 'note', deleteField()));
    // Rewriting the whole map with the server's values left as they are is not a change to them.
    await assertSucceeds(
      updateDoc(itemRef(USERS.member), {
        values: { timer: { running: false }, files: [{ name: 'a.png' }], note: 'again' },
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
  });

  it('lets an editor rename, move and archive an item that holds server-managed values', async () => {
    const uid = USERS.member;
    await assertSucceeds(
      updateDoc(itemRef(uid), { name: 'Renamed', updatedAt: serverTimestamp(), updatedBy: uid }),
    );
    await assertSucceeds(
      updateDoc(itemRef(uid), { state: 'archived', updatedAt: serverTimestamp(), updatedBy: uid }),
    );
  });

  it('refuses a whole batch when one write touches a server-managed value', async () => {
    const uid = USERS.member;
    const db = as(uid);
    const batch = writeBatch(db);
    batch.set(doc(db, 'boards', MANAGED_BOARD, 'items', 'b1'), newItem(uid));
    batch.set(
      doc(db, 'boards', MANAGED_BOARD, 'items', 'b2'),
      newItem(uid, { values: { timer: { running: true } } }),
    );
    await assertFails(batch.commit());
  });

  it('keeps viewers and outsiders out as before', async () => {
    for (const uid of [USERS.viewer, USERS.outsider]) {
      await assertFails(writeCell(uid, MANAGED_BOARD, 'note', 'x'));
    }
  });
});

describe('boards without serverManagedColumnIds', () => {
  it('FW1-era boards treat the list as empty but keep the derived list', async () => {
    const uid = USERS.member;
    await assertSucceeds(writeCell(uid, FW1_BOARD, 'timer', { anything: true }));
    await assertSucceeds(
      setDoc(itemRef(uid, FW1_BOARD, 'n1'), newItem(uid, { values: { files: [], note: 'x' } })),
    );
  });

  it('legacy boards with neither field accept any value', async () => {
    const uid = USERS.member;
    await assertSucceeds(writeCell(uid, LEGACY_BOARD, 'timer', 'anything'));
    await assertSucceeds(
      setDoc(itemRef(uid, LEGACY_BOARD, 'n1'), newItem(uid, { values: { calc: 1, files: [] } })),
    );
  });

  it('can still be edited by an editor', async () => {
    for (const id of [FW1_BOARD, LEGACY_BOARD]) {
      await assertSucceeds(
        updateDoc(boardRef(USERS.member, id), {
          name: 'Renamed',
          updatedAt: serverTimestamp(),
          updatedBy: USERS.member,
        }),
      );
    }
  });
});

describe('boards/{id}/activity is read-only for clients', () => {
  const activityRef = (uid: string, id = 'a1') =>
    doc(as(uid), 'boards', MANAGED_BOARD, 'activity', id);

  it('lets board readers read it and refuses outsiders (full matrix: activity.test.ts)', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      await assertSucceeds(getDoc(activityRef(uid)));
      await assertSucceeds(getDocs(collection(as(uid), 'boards', MANAGED_BOARD, 'activity')));
    }
    await assertFails(getDoc(activityRef(USERS.outsider)));
  });

  it('denies every client create, update and delete', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      await assertFails(
        setDoc(activityRef(uid, `new-${uid}`), { type: 'button_click', actorId: uid }),
      );
      await assertFails(
        addDoc(collection(as(uid), 'boards', MANAGED_BOARD, 'activity'), { type: 'forged' }),
      );
      await assertFails(updateDoc(activityRef(uid), { type: 'edited' }));
      await assertFails(deleteDoc(activityRef(uid)));
    }
  });
});
