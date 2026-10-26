import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { FieldPath, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, USERS, boardDoc, createTestEnv, itemDoc, seedFixture } from './helpers';

/** P1 subitems: one level deep, same board and group as the parent, parent immutable. */

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
        columns: [{ id: 'calc', type: 'formula', title: 'Calc', position: 'a0', settings: {} }],
        subitemColumns: [
          { id: 'subcalc', type: 'formula', title: 'Sub calc', position: 'a0', settings: {} },
          { id: 'subfiles', type: 'files', title: 'Files', position: 'a1', settings: {} },
          { id: 'subnote', type: 'text', title: 'Note', position: 'a2', settings: {} },
        ],
        derivedColumnIds: ['calc', 'subcalc'],
        serverManagedColumnIds: ['subfiles'],
      }),
    );
    await setDoc(doc(db, 'boards', OTHER_BOARD), boardDoc());
    // i1 (seed) is a top-level item in g1. p2 is a subitem of i1, a1 is archived, i2 lives in g2.
    await setDoc(doc(db, 'boards', MAIN_BOARD, 'items', 'sub1'), itemDoc({ parentItemId: 'i1' }));
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

  it('accepts subitem values on non-derived subitem columns', async () => {
    await assertSucceeds(
      setDoc(itemRef(USERS.member, 'new2'), subitem(USERS.member, { values: { subnote: 'x' } })),
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

describe('subitem column locks', () => {
  const write = (uid: string, id: string, columnId: string, value: unknown) =>
    updateDoc(
      itemRef(uid, id),
      new FieldPath('values', columnId),
      value,
      'updatedAt',
      serverTimestamp(),
      'updatedBy',
      uid,
    );

  it('allows a normal subitem column', async () => {
    await assertSucceeds(write(USERS.member, 'sub1', 'subnote', 'hi'));
  });

  it('refuses derived and server-managed subitem columns', async () => {
    await assertFails(write(USERS.member, 'sub1', 'subcalc', 1));
    await assertFails(write(USERS.member, 'sub1', 'subfiles', []));
    await assertFails(
      setDoc(itemRef(USERS.member, 'new9'), subitem(USERS.member, { values: { subcalc: 1 } })),
    );
    await assertFails(
      setDoc(itemRef(USERS.member, 'new10'), subitem(USERS.member, { values: { subfiles: [] } })),
    );
  });
});
