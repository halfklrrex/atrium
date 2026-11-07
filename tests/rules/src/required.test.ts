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
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { USERS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * REQ-1: a column marked `required` is a hard rule. `boards/{id}.requiredColumnIds` is maintained
 * only by the onBoardColumnsWritten function (clients create boards with `[]` and can never change
 * it), and an item update may not empty a `values.<id>` listed there. Creating an item is exempt,
 * existing empty cells are never rewritten, and the check is unrolled over the first 10 entries of
 * the list (REQUIRED_COLUMN_RULE_CAP in @atrium/shared): a write touching a required column at
 * position 11 or later is refused (fail closed).
 */

let env: RulesTestEnvironment;

/** `title` and `owner` are required; `note` and `extra` are ordinary. */
const REQ_BOARD = 'boardReq';
/** A board from before REQ-1: no `requiredColumnIds` field. */
const LEGACY_BOARD = 'boardPreReq';
/** 10 and 11 required columns (`c0` .. `c9` / `c10`). */
const CAP10_BOARD = 'boardCap10';
const CAP11_BOARD = 'boardCap11';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);
const fullValues = (n: number) => Object.fromEntries(ids(n).map((id) => [id, 'x']));

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
    await setDoc(doc(db, 'boards', REQ_BOARD), boardDoc({ requiredColumnIds: ['owner', 'title'] }));
    await setDoc(
      doc(db, 'boards', REQ_BOARD, 'items', 'i1'),
      itemDoc({ values: { title: 'T', owner: 'o', note: 'n', extra: 'e' } }),
    );
    // An item whose required cell is already empty.
    await setDoc(
      doc(db, 'boards', REQ_BOARD, 'items', 'empty'),
      itemDoc({ values: { note: 'n', extra: 'e' } }),
    );
    const { requiredColumnIds: _unused, ...legacy } = boardDoc();
    await setDoc(doc(db, 'boards', LEGACY_BOARD), legacy);
    await setDoc(
      doc(db, 'boards', LEGACY_BOARD, 'items', 'i1'),
      itemDoc({ values: { title: 'T', note: 'n' } }),
    );
    for (const [id, n] of [
      [CAP10_BOARD, 10],
      [CAP11_BOARD, 11],
    ] as const) {
      await setDoc(doc(db, 'boards', id), boardDoc({ requiredColumnIds: ids(n) }));
      await setDoc(doc(db, 'boards', id, 'items', 'i1'), itemDoc({ values: fullValues(n) }));
    }
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const boardRef = (uid: string, id = REQ_BOARD) => doc(as(uid), 'boards', id);
const itemRef = (uid: string, boardId = REQ_BOARD, id = 'i1') =>
  doc(as(uid), 'boards', boardId, 'items', id);

const newBoard = (uid: string, overrides: Record<string, unknown> = {}) =>
  boardDoc({
    access: { [uid]: 'owner' },
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

/** Field-path cell write with the audit fields, as the board table sends it. */
const writeCell = (uid: string, boardId: string, columnId: string, value: unknown, id = 'i1') =>
  updateDoc(
    itemRef(uid, boardId, id),
    new FieldPath('values', columnId),
    value,
    'updatedAt',
    serverTimestamp(),
    'updatedBy',
    uid,
  );

/** Several field-path cell writes in one update. */
function writeCells(uid: string, boardId: string, cells: Record<string, unknown>) {
  const args: unknown[] = [];
  for (const [k, v] of Object.entries(cells)) args.push(new FieldPath('values', k), v);
  args.push('updatedAt', serverTimestamp(), 'updatedBy', uid);
  const [first, ...rest] = args as [FieldPath, unknown, ...unknown[]];
  return updateDoc(itemRef(uid, boardId), first, ...(rest as [unknown, ...unknown[]]));
}

const EDITORS = [USERS.owner, USERS.admin, USERS.member] as const;

describe('board create requires requiredColumnIds == []', () => {
  it('accepts an empty list', async () => {
    await assertSucceeds(setDoc(boardRef(USERS.member, 'new-ok'), newBoard(USERS.member)));
  });

  it('rejects a missing field and any non-empty or malformed value', async () => {
    const { requiredColumnIds: _unused, ...withoutField } = newBoard(USERS.member);
    await assertFails(setDoc(boardRef(USERS.member, 'new-missing'), withoutField));
    await assertFails(
      setDoc(
        boardRef(USERS.member, 'new-forged'),
        newBoard(USERS.member, { requiredColumnIds: ['title'] }),
      ),
    );
    await assertFails(
      setDoc(
        boardRef(USERS.member, 'new-null'),
        newBoard(USERS.member, { requiredColumnIds: null }),
      ),
    );
  });
});

describe('clients cannot change requiredColumnIds', () => {
  it('denies setting, changing and deleting it, including by the board owner', async () => {
    for (const uid of EDITORS) {
      for (const value of [[], ['title'], ['title', 'owner', 'note'], deleteField()]) {
        await assertFails(
          updateDoc(boardRef(uid), {
            requiredColumnIds: value,
            updatedAt: serverTimestamp(),
            updatedBy: uid,
          }),
        );
      }
    }
  });

  it('denies adding the field to a board from before REQ-1, but still lets editors update it', async () => {
    await assertFails(
      updateDoc(boardRef(USERS.owner, LEGACY_BOARD), {
        requiredColumnIds: ['title'],
        updatedAt: serverTimestamp(),
        updatedBy: USERS.owner,
      }),
    );
    await assertSucceeds(
      updateDoc(boardRef(USERS.member, LEGACY_BOARD), {
        name: 'Renamed',
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
  });
});

describe('items: required cells cannot be emptied', () => {
  it('lets editors set a required cell to any non-empty value', async () => {
    for (const uid of EDITORS) {
      for (const value of ['hello', 0, false, ['a'], { k: 1 }, ' ']) {
        await assertSucceeds(writeCell(uid, REQ_BOARD, 'title', value));
      }
    }
  });

  it('denies clearing a required cell by deleteField, null, empty string, list or map', async () => {
    for (const uid of EDITORS) {
      for (const value of [deleteField(), null, '', [], {}]) {
        await assertFails(writeCell(uid, REQ_BOARD, 'title', value));
        await assertFails(writeCell(uid, REQ_BOARD, 'owner', value));
      }
    }
  });

  it('denies clearing next to a non-required write, and a multi-key write that clears two', async () => {
    const uid = USERS.member;
    await assertFails(writeCells(uid, REQ_BOARD, { title: '', note: 'changed' }));
    await assertFails(writeCells(uid, REQ_BOARD, { title: '', owner: '' }));
    await assertFails(writeCells(uid, REQ_BOARD, { title: 'ok', owner: deleteField() }));
    await assertSucceeds(writeCells(uid, REQ_BOARD, { title: 'ok', owner: 'ok2', note: '' }));
  });

  it('denies clearing through a whole-map write', async () => {
    const uid = USERS.member;
    await assertFails(
      updateDoc(itemRef(uid), {
        values: { owner: 'o', note: 'n', extra: 'e' },
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
    await assertSucceeds(
      updateDoc(itemRef(uid), {
        values: { title: 'T2', owner: 'o', note: 'n', extra: 'e' },
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      }),
    );
  });

  it('denies viewers and outsiders both setting and clearing', async () => {
    for (const uid of [USERS.viewer, USERS.outsider]) {
      await assertFails(writeCell(uid, REQ_BOARD, 'title', 'x'));
      await assertFails(writeCell(uid, REQ_BOARD, 'title', ''));
    }
  });

  it('lets editors clear a non-required cell', async () => {
    for (const uid of EDITORS) {
      await assertSucceeds(writeCell(uid, REQ_BOARD, 'note', deleteField()));
      await assertSucceeds(writeCell(uid, REQ_BOARD, 'extra', ''));
    }
  });
});

describe('items: existing and exempt cases', () => {
  it('lets an editor edit another cell while a required cell is already empty', async () => {
    for (const uid of EDITORS) {
      await assertSucceeds(writeCell(uid, REQ_BOARD, 'note', `by ${uid}`, 'empty'));
    }
    await assertSucceeds(
      updateDoc(itemRef(USERS.member, REQ_BOARD, 'empty'), {
        name: 'Renamed',
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
  });

  it('puts no limit on a board without requiredColumnIds', async () => {
    await assertSucceeds(writeCell(USERS.member, LEGACY_BOARD, 'title', deleteField()));
    await assertSucceeds(writeCell(USERS.member, LEGACY_BOARD, 'note', ''));
  });

  it('lets an editor create an item with no required values', async () => {
    for (const uid of EDITORS) {
      await assertSucceeds(
        setDoc(
          itemRef(uid, REQ_BOARD, `new-${uid}`),
          itemDoc({
            createdBy: uid,
            updatedBy: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
        ),
      );
    }
  });
});

describe('items: the 10 column cap', () => {
  it('on a board with 10 required columns, checks the last one by value', async () => {
    const uid = USERS.member;
    await assertFails(writeCell(uid, CAP10_BOARD, 'c9', ''));
    await assertFails(writeCell(uid, CAP10_BOARD, 'c9', deleteField()));
    await assertSucceeds(writeCell(uid, CAP10_BOARD, 'c9', 'new'));
    await assertFails(writeCell(uid, CAP10_BOARD, 'c0', null));
    await assertSucceeds(writeCell(uid, CAP10_BOARD, 'c0', 'new'));
  });

  it('on a board with 10 required columns, refuses a multi-key write that clears any of them', async () => {
    const uid = USERS.member;
    const cells = Object.fromEntries(ids(10).map((id) => [id, 'y']));
    await assertSucceeds(writeCells(uid, CAP10_BOARD, cells));
    await assertFails(writeCells(uid, CAP10_BOARD, { ...cells, c7: '' }));
    await assertFails(writeCells(uid, CAP10_BOARD, { ...cells, c9: deleteField() }));
  });

  it('on a board with 11 required columns, refuses any write to the 11th (fail closed)', async () => {
    const uid = USERS.member;
    await assertFails(writeCell(uid, CAP11_BOARD, 'c10', 'new'));
    await assertFails(writeCell(uid, CAP11_BOARD, 'c10', ''));
    await assertFails(writeCell(uid, CAP11_BOARD, 'c10', deleteField()));
    await assertFails(writeCells(uid, CAP11_BOARD, { c0: 'a', c10: 'b' }));
  });

  it('on a board with 11 required columns, the first 10 are still checked and settable', async () => {
    const uid = USERS.member;
    await assertSucceeds(writeCell(uid, CAP11_BOARD, 'c0', 'new'));
    await assertSucceeds(writeCell(uid, CAP11_BOARD, 'c9', 'new'));
    await assertFails(writeCell(uid, CAP11_BOARD, 'c9', ''));
    await assertFails(writeCell(uid, CAP11_BOARD, 'c0', deleteField()));
  });
});

describe('bulk edit Undo (P1-bulk-edit-selected v3): why it must plan around required cells', () => {
  it('lets the forward write fill an empty required cell, then refuses the Undo that empties it again', async () => {
    const uid = USERS.member;
    // Forward bulk write: the cell was empty, now it is filled.
    await assertSucceeds(writeCell(uid, REQ_BOARD, 'title', 'Done', 'empty'));
    // Undo shape of setValueMany for a row whose previous value was empty: deleteField().
    await assertFails(writeCell(uid, REQ_BOARD, 'title', deleteField(), 'empty'));
    // A row that had a value restores fine in the same Undo.
    await assertSucceeds(writeCell(uid, REQ_BOARD, 'title', 'T', 'i1'));
  });

  it('allows deleting a required cell that is still empty (nothing changes), so only a filled one is refused', async () => {
    await assertSucceeds(writeCell(USERS.member, REQ_BOARD, 'title', deleteField(), 'empty'));
  });
});
