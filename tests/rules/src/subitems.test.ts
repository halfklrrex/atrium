import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  FieldPath,
  deleteField,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  MAIN_BOARD,
  USERS,
  boardDoc,
  createTestEnv,
  itemDoc,
  replyDocData,
  seedFixture,
  updateDocData,
} from './helpers';

/**
 * P1 subitems: one level deep, same board and group as the parent, parent immutable. Since
 * SUBITEMS-as-items a subitem uses the board's columns, so every column rule applies to it as to an
 * item, and `subitemColumns` is `[]` on every board (client writes of it are refused).
 */

let env: RulesTestEnvironment;
const OTHER_BOARD = 'boardOther';

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
      doc(db, 'boards', MAIN_BOARD),
      boardDoc({
        columns: [
          { id: 'calc', type: 'formula', title: 'Calc', position: 'a0', settings: {} },
          { id: 'files', type: 'files', title: 'Files', position: 'a1', settings: {} },
          { id: 'note', type: 'text', title: 'Note', position: 'a2', settings: {} },
          { id: 'locked', type: 'text', title: 'Locked', position: 'a3', settings: {} },
          { id: 'req', type: 'text', title: 'Required', position: 'a4', settings: {} },
        ],
        derivedColumnIds: ['calc'],
        serverManagedColumnIds: ['files'],
        requiredColumnIds: ['req'],
        columnLocks: ['locked'],
      }),
    );
    await setDoc(doc(db, 'boards', OTHER_BOARD), boardDoc());
    // i1 (seed) is a top-level item in g1. p2 is a subitem of i1, a1 is archived, i2 lives in g2.
    await setDoc(
      doc(db, 'boards', MAIN_BOARD, 'items', 'sub1'),
      itemDoc({ parentItemId: 'i1', values: { req: 'x', locked: 'l' } }),
    );
    await setDoc(
      doc(db, 'boards', MAIN_BOARD, 'items', 'sub1', 'updates', 'su1'),
      updateDocData({ itemId: 'sub1' }),
    );
    await setDoc(
      doc(db, 'boards', MAIN_BOARD, 'items', 'sub1', 'updates', 'su1', 'replies', 'sr1'),
      replyDocData({ updateId: 'su1' }),
    );
    await setDoc(doc(db, 'boards', MAIN_BOARD, 'items', 'arch'), itemDoc({ state: 'archived' }));
    await setDoc(doc(db, 'boards', OTHER_BOARD, 'items', 'foreign'), itemDoc());
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const itemRef = (uid: string, id: string, boardId = MAIN_BOARD) =>
  doc(as(uid), 'boards', boardId, 'items', id);

const subitem = (uid: string, overrides: Record<string, unknown> = {}) =>
  itemDoc({
    parentItemId: 'i1',
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

describe('creating a subitem', () => {
  it('accepts a subitem of an active top-level item in the same group', async () => {
    await assertSucceeds(setDoc(itemRef(USERS.member, 'new1'), subitem(USERS.member)));
  });

  it('accepts subitem values on non-derived board columns', async () => {
    await assertSucceeds(
      setDoc(itemRef(USERS.member, 'new2'), subitem(USERS.member, { values: { note: 'x' } })),
    );
  });

  it('accepts and updates a value in a board column (subitems share the board columns)', async () => {
    await assertSucceeds(
      setDoc(itemRef(USERS.member, 'shared1'), subitem(USERS.member, { values: { note: 'x' } })),
    );
    await assertSucceeds(
      updateDoc(
        itemRef(USERS.member, 'shared1'),
        new FieldPath('values', 'note'),
        'y',
        'updatedAt',
        serverTimestamp(),
        'updatedBy',
        USERS.member,
      ),
    );
  });

  it('refuses a parent that does not exist', async () => {
    await assertFails(
      setDoc(itemRef(USERS.member, 'new3'), subitem(USERS.member, { parentItemId: 'nope' })),
    );
  });

  it('refuses a parent that lives in another board', async () => {
    await assertFails(
      setDoc(itemRef(USERS.member, 'new4'), subitem(USERS.member, { parentItemId: 'foreign' })),
    );
  });

  it('refuses a grandchild (parent is itself a subitem)', async () => {
    await assertFails(
      setDoc(itemRef(USERS.member, 'new5'), subitem(USERS.member, { parentItemId: 'sub1' })),
    );
  });

  it('refuses a group that differs from the parent', async () => {
    await assertFails(
      setDoc(itemRef(USERS.member, 'new6'), subitem(USERS.member, { groupId: 'g2' })),
    );
  });

  it('refuses a parent that is not active', async () => {
    await assertFails(
      setDoc(itemRef(USERS.member, 'new7'), subitem(USERS.member, { parentItemId: 'arch' })),
    );
  });

  it('refuses a viewer', async () => {
    await assertFails(setDoc(itemRef(USERS.viewer, 'new8'), subitem(USERS.viewer)));
  });

  it('accepts a duplicated parent and its subitems created in one batch', async () => {
    const db = as(USERS.member);
    const batch = writeBatch(db);
    batch.set(
      doc(db, 'boards', MAIN_BOARD, 'items', 'dupParent'),
      itemDoc({
        createdBy: USERS.member,
        updatedBy: USERS.member,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    batch.set(
      doc(db, 'boards', MAIN_BOARD, 'items', 'dupChild'),
      subitem(USERS.member, { parentItemId: 'dupParent' }),
    );
    await assertSucceeds(batch.commit());
  });
});

describe('parentItemId is immutable', () => {
  const audit = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

  it('refuses turning a subitem into a top-level item', async () => {
    await assertFails(
      updateDoc(itemRef(USERS.member, 'sub1'), { parentItemId: null, ...audit(USERS.member) }),
    );
  });

  it('refuses turning an item into a subitem', async () => {
    await assertFails(
      updateDoc(itemRef(USERS.member, 'arch'), { parentItemId: 'i1', ...audit(USERS.member) }),
    );
  });

  it('refuses re-parenting a subitem', async () => {
    await assertFails(
      updateDoc(itemRef(USERS.member, 'sub1'), { parentItemId: 'arch', ...audit(USERS.member) }),
    );
  });

  it('still allows moving a subitem within its parent and editing it', async () => {
    await assertSucceeds(
      updateDoc(itemRef(USERS.member, 'sub1'), {
        position: 'a5',
        name: 'Renamed',
        ...audit(USERS.member),
      }),
    );
  });
});

describe('subitems and the board columns', () => {
  const audit = (uid: string) => ['updatedAt', serverTimestamp(), 'updatedBy', uid] as const;
  const write = (uid: string, id: string, columnId: string, value: unknown) =>
    updateDoc(itemRef(uid, id), new FieldPath('values', columnId), value, ...audit(uid));

  it('allows a normal board column on a subitem', async () => {
    await assertSucceeds(write(USERS.member, 'sub1', 'note', 'hi'));
  });

  it('refuses derived and server-managed board columns on a subitem', async () => {
    await assertFails(write(USERS.member, 'sub1', 'calc', 1));
    await assertFails(write(USERS.member, 'sub1', 'files', []));
    await assertFails(
      setDoc(itemRef(USERS.member, 'new9'), subitem(USERS.member, { values: { calc: 1 } })),
    );
    await assertFails(
      setDoc(itemRef(USERS.member, 'new10'), subitem(USERS.member, { values: { files: [] } })),
    );
  });

  it('refuses a locked board column on a subitem for a non-owner and allows an owner', async () => {
    await assertFails(write(USERS.member, 'sub1', 'locked', 'edit'));
    await assertFails(
      setDoc(itemRef(USERS.member, 'new11'), subitem(USERS.member, { values: { locked: 'x' } })),
    );
    await assertSucceeds(write(USERS.owner, 'sub1', 'locked', 'edit'));
  });

  it('refuses emptying a required board column on a subitem, and allows changing it', async () => {
    await assertFails(write(USERS.member, 'sub1', 'req', ''));
    await assertFails(write(USERS.member, 'sub1', 'req', deleteField()));
    await assertSucceeds(write(USERS.member, 'sub1', 'req', 'y'));
  });
});

describe("a subitem's feed", () => {
  const feedUpdate = (uid: string, overrides: Record<string, unknown> = {}) =>
    updateDocData({
      itemId: 'sub1',
      authorId: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...overrides,
    });
  const updateRef = (uid: string, id = 'su1') =>
    doc(as(uid), 'boards', MAIN_BOARD, 'items', 'sub1', 'updates', id);

  it('lets an editor post an update, like it, reply and bump the counters', async () => {
    await assertSucceeds(setDoc(updateRef(USERS.member, 'su2'), feedUpdate(USERS.member)));
    await assertSucceeds(updateDoc(itemRef(USERS.member, 'sub1'), { updatesCount: increment(1) }));
    await assertSucceeds(updateDoc(updateRef(USERS.member), { likes: [USERS.member] }));
    await assertSucceeds(
      setDoc(
        doc(
          as(USERS.member),
          'boards',
          MAIN_BOARD,
          'items',
          'sub1',
          'updates',
          'su1',
          'replies',
          'sr2',
        ),
        replyDocData({
          updateId: 'su1',
          authorId: USERS.member,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      ),
    );
    await assertSucceeds(updateDoc(updateRef(USERS.member), { repliesCount: 1 }));
  });

  it('refuses a viewer', async () => {
    await assertFails(setDoc(updateRef(USERS.viewer, 'su3'), feedUpdate(USERS.viewer)));
    await assertFails(updateDoc(itemRef(USERS.viewer, 'sub1'), { updatesCount: increment(1) }));
  });
});

describe('boards and subitemColumns', () => {
  const boardRef = (uid: string, id: string) => doc(as(uid), 'boards', id);
  const newBoard = (uid: string, overrides: Record<string, unknown> = {}) =>
    boardDoc({
      access: { [uid]: 'owner' },
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...overrides,
    });
  const column = { id: 'sub_note', type: 'text', title: 'Note', position: 'a0', settings: {} };

  it('creates a board with subitemColumns [] and refuses a non-empty one', async () => {
    await assertSucceeds(setDoc(boardRef(USERS.member, 'nb1'), newBoard(USERS.member)));
    await assertFails(
      setDoc(boardRef(USERS.member, 'nb2'), newBoard(USERS.member, { subitemColumns: [column] })),
    );
    await assertFails(
      setDoc(boardRef(USERS.member, 'nb3'), newBoard(USERS.member, { subitemColumns: null })),
    );
  });

  it("refuses an editor's update that changes subitemColumns and allows one that leaves it", async () => {
    const audit = { updatedAt: serverTimestamp(), updatedBy: USERS.member };
    await assertFails(
      updateDoc(boardRef(USERS.member, MAIN_BOARD), { subitemColumns: [column], ...audit }),
    );
    await assertFails(
      updateDoc(boardRef(USERS.owner, MAIN_BOARD), {
        subitemColumns: [column],
        updatedAt: serverTimestamp(),
        updatedBy: USERS.owner,
      }),
    );
    await assertSucceeds(
      updateDoc(boardRef(USERS.member, MAIN_BOARD), { name: 'Renamed', ...audit }),
    );
  });
});
