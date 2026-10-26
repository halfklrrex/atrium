import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  FieldPath,
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAIN_BOARD, USERS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * P1b: what the board table writes. Cell edits are field-path updates (`values.<col>`), rows are
 * soft-deleted and restored, columns and groups are replaced in transactions, and big actions
 * (duplicate a column, delete a group) go in batches of up to 400 documents.
 */

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
const itemIn = (db: ReturnType<typeof as>, id = 'i1', boardId = MAIN_BOARD) =>
  doc(db, 'boards', boardId, 'items', id);
const item = (uid: string, id = 'i1', boardId = MAIN_BOARD) => itemIn(as(uid), id, boardId);

/** The two audit fields every item update must carry. */
const audit = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

describe('cell edits as field-path updates', () => {
  it('lets an editor set and clear one cell through `values.<columnId>`', async () => {
    const uid = USERS.member;
    await assertSucceeds(
      updateDoc(
        item(uid),
        new FieldPath('values', 'status'),
        { index: 1 },
        'updatedAt',
        serverTimestamp(),
        'updatedBy',
        uid,
      ),
    );
    await assertSucceeds(
      updateDoc(
        item(uid),
        new FieldPath('values', 'status'),
        deleteField(),
        'updatedAt',
        serverTimestamp(),
        'updatedBy',
        uid,
      ),
    );
  });

  it('keeps other cells when one cell is written (no whole-map overwrite)', async () => {
    const uid = USERS.admin;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'boards', MAIN_BOARD, 'items', 'two'),
        itemDoc({ values: { a: 'x', b: 'y' } }),
      );
    });
    await assertSucceeds(
      updateDoc(
        item(uid, 'two'),
        new FieldPath('values', 'a'),
        'changed',
        'updatedAt',
        serverTimestamp(),
        'updatedBy',
        uid,
      ),
    );
    const snap = await assertSucceeds(getDoc(item(uid, 'two')));
    expect(snap.data()?.values).toEqual({ a: 'changed', b: 'y' });
  });

  it('denies a cell edit without the audit fields or with someone else as `updatedBy`', async () => {
    const uid = USERS.member;
    await assertFails(updateDoc(item(uid), new FieldPath('values', 'status'), { index: 1 }));
    await assertFails(
      updateDoc(
        item(uid),
        new FieldPath('values', 'status'),
        { index: 1 },
        'updatedAt',
        serverTimestamp(),
        'updatedBy',
        USERS.owner,
      ),
    );
  });

  it('denies cell edits by viewers and outsiders', async () => {
    for (const uid of [USERS.viewer, USERS.outsider]) {
      await assertFails(
        updateDoc(
          item(uid),
          new FieldPath('values', 'status'),
          { index: 1 },
          'updatedAt',
          serverTimestamp(),
          'updatedBy',
          uid,
        ),
      );
    }
  });

  it('supports atomic vote toggling via arrayUnion and arrayRemove without losing concurrent votes', async () => {
    const userA = USERS.member;
    const userB = USERS.admin;
    const itemRefA = item(userA, 'i1');
    const itemRefB = item(userB, 'i1');

    // Two users vote concurrently on the same item's vote column
    await Promise.all([
      assertSucceeds(
        updateDoc(
          itemRefA,
          new FieldPath('values', 'vote_col', 'votersIds'),
          arrayUnion(userA),
          'updatedAt',
          serverTimestamp(),
          'updatedBy',
          userA,
        ),
      ),
      assertSucceeds(
        updateDoc(
          itemRefB,
          new FieldPath('values', 'vote_col', 'votersIds'),
          arrayUnion(userB),
          'updatedAt',
          serverTimestamp(),
          'updatedBy',
          userB,
        ),
      ),
    ]);

    // Both votes should be present
    const snapAfterVotes = await assertSucceeds(getDoc(itemRefA));
    const voters = (snapAfterVotes.data()?.values?.vote_col as { votersIds?: string[] } | undefined)
      ?.votersIds;
    expect(voters).toEqual(expect.arrayContaining([userA, userB]));
    expect(voters).toHaveLength(2);

    // User A untoggles their vote using arrayRemove
    await assertSucceeds(
      updateDoc(
        itemRefA,
        new FieldPath('values', 'vote_col', 'votersIds'),
        arrayRemove(userA),
        'updatedAt',
        serverTimestamp(),
        'updatedBy',
        userA,
      ),
    );

    const snapAfterUntoggle = await assertSucceeds(getDoc(itemRefA));
    const votersAfter = (
      snapAfterUntoggle.data()?.values?.vote_col as { votersIds?: string[] } | undefined
    )?.votersIds;
    expect(votersAfter).toEqual([userB]);
  });
});

describe('soft delete, archive and undo', () => {
  it('lets an editor archive, delete and restore an item', async () => {
    const uid = USERS.member;
    await assertSucceeds(updateDoc(item(uid), { state: 'archived', ...audit(uid) }));
    await assertSucceeds(
      updateDoc(item(uid), { state: 'deleted', deletedAt: serverTimestamp(), ...audit(uid) }),
    );
    await assertSucceeds(updateDoc(item(uid), { state: 'active', deletedAt: null, ...audit(uid) }));
  });

  it('denies a viewer', async () => {
    await assertFails(
      updateDoc(item(USERS.viewer), {
        state: 'deleted',
        deletedAt: serverTimestamp(),
        ...audit(USERS.viewer),
      }),
    );
  });

  it('lets an editor move an item to another group and position', async () => {
    const uid = USERS.admin;
    await assertSucceeds(updateDoc(item(uid), { groupId: 'g2', position: 'a1V', ...audit(uid) }));
  });
});

describe('board structure: columns and groups', () => {
  const column = { id: 'c1', type: 'text', title: 'Notes', position: 'a0', settings: {} };
  const group = { id: 'g1', title: 'Group', color: '#579bfc', position: 'a0' };
  const boardRef = (uid: string) => doc(as(uid), 'boards', MAIN_BOARD);

  it('lets an editor replace `columns` and `groups` (the whole array, inside a transaction)', async () => {
    const db = as(USERS.member);
    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const ref = doc(db, 'boards', MAIN_BOARD);
        const snap = await tx.get(ref);
        tx.update(ref, {
          columns: [...(snap.data()?.columns ?? []), column],
          groups: [...(snap.data()?.groups ?? []), group],
          updatedAt: serverTimestamp(),
        });
      }),
    );
  });

  it('lets an editor resize a column (a `width` change inside the array)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'boards', 'wide'),
        boardDoc({ columns: [column], groups: [group] }),
      );
    });
    await assertSucceeds(
      updateDoc(doc(as(USERS.member), 'boards', 'wide'), {
        columns: [{ ...column, width: 220 }],
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies structure changes by viewers and outsiders', async () => {
    for (const uid of [USERS.viewer, USERS.outsider]) {
      await assertFails(
        updateDoc(boardRef(uid), { columns: [column], updatedAt: serverTimestamp() }),
      );
      await assertFails(
        updateDoc(boardRef(uid), { groups: [group], updatedAt: serverTimestamp() }),
      );
    }
  });

  it("still keeps lifecycle state out of an editor's reach", async () => {
    await assertFails(
      updateDoc(boardRef(USERS.member), {
        state: 'deleted',
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('big batches (duplicate column, delete group, move many)', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `bulk-${i}`);

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (let start = 0; start < 400; start += 200) {
        const batch = writeBatch(db);
        for (const id of ids(400).slice(start, start + 200)) {
          batch.set(doc(db, 'boards', MAIN_BOARD, 'items', id), itemDoc({ values: { c: 'v' } }));
        }
        await batch.commit();
      }
    });
  });

  it('lets an editor update 400 items in one batch (each carrying the audit fields)', async () => {
    const uid = USERS.member;
    const db = as(uid);
    const batch = writeBatch(db);
    for (const id of ids(400)) {
      batch.update(
        itemIn(db, id),
        new FieldPath('values', 'c'),
        deleteField(),
        'updatedAt',
        serverTimestamp(),
        'updatedBy',
        uid,
      );
    }
    await assertSucceeds(batch.commit());
  });

  it('lets an editor soft-delete 400 items in one batch', async () => {
    const uid = USERS.admin;
    const db = as(uid);
    const batch = writeBatch(db);
    for (const id of ids(400)) {
      batch.update(itemIn(db, id), {
        state: 'deleted',
        deletedAt: serverTimestamp(),
        ...audit(uid),
      });
    }
    await assertSucceeds(batch.commit());
  });

  it('lets an editor create 400 items in one batch', async () => {
    const uid = USERS.member;
    const db = as(uid);
    const batch = writeBatch(db);
    for (let i = 0; i < 400; i++) {
      batch.set(
        itemIn(db, `copy-${i}`),
        itemDoc({
          createdBy: uid,
          updatedBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );
    }
    await assertSucceeds(batch.commit());
  });

  it('denies the same batch to a viewer', async () => {
    const uid = USERS.viewer;
    const db = as(uid);
    const batch = writeBatch(db);
    batch.update(itemIn(db, 'bulk-0'), {
      state: 'deleted',
      deletedAt: serverTimestamp(),
      ...audit(uid),
    });
    await assertFails(batch.commit());
  });
});

describe('a new board and its sample items', () => {
  const owner = USERS.member; // workspace members may create boards

  const newBoard = () =>
    boardDoc({
      access: { [owner]: 'owner' },
      createdBy: owner,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  const newItem = () =>
    itemDoc({
      createdBy: owner,
      updatedBy: owner,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

  it('accepts the sample items once the board exists (two writes: the board, then the batch)', async () => {
    const db = as(owner);
    await assertSucceeds(setDoc(doc(db, 'boards', 'fresh'), newBoard()));
    const batch = writeBatch(db);
    for (let i = 0; i < 5; i++) batch.set(doc(db, 'boards', 'fresh', 'items', `s${i}`), newItem());
    await assertSucceeds(batch.commit());
  });

  it('denies creating items in the same batch as their board (rules read the board before the batch)', async () => {
    // This is why `writes.createBoard` makes the board first and the sample items second.
    const db = as(owner);
    const batch = writeBatch(db);
    batch.set(doc(db, 'boards', 'atomic'), newBoard());
    batch.set(doc(db, 'boards', 'atomic', 'items', 's0'), newItem());
    await assertFails(batch.commit());
  });

  it("still blocks sample items on someone else's board", async () => {
    await assertFails(
      setDoc(doc(as(USERS.outsider), 'boards', MAIN_BOARD, 'items', 'x'), newItem()),
    );
  });
});
