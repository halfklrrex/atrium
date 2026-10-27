import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  FieldPath,
  deleteField,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, USERS, createTestEnv, itemDoc, seedFixture } from './helpers';

/**
 * P2 numeric item IDs: `seq` (account-wide) and `boardSeq` (per board) are assigned only by the
 * onItemCreated Cloud Function (Admin SDK, bypasses rules). The counters it uses
 * (`counters/items`, `boards/{id}/counters/items`) are Functions-only too.
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
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(
      doc(db, 'boards', MAIN_BOARD, 'items', 'numbered'),
      itemDoc({ name: 'Numbered', seq: 5, boardSeq: 2, updatesCount: 0 }),
    );
    await setDoc(doc(db, 'counters', 'items'), { next: 5 });
    await setDoc(doc(db, 'boards', MAIN_BOARD, 'counters', 'items'), {
      nextItem: 2,
      nextSubitem: 0,
    });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const itemRef = (uid: string, id = 'numbered') => doc(as(uid), 'boards', MAIN_BOARD, 'items', id);

const newItem = (uid: string, overrides: Record<string, unknown> = {}) =>
  itemDoc({
    createdBy: uid,
    updatedBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  });

describe('seq and boardSeq are server-assigned', () => {
  it('lets an editor create an item without them', async () => {
    await assertSucceeds(setDoc(itemRef(USERS.member, 'plain'), newItem(USERS.member)));
  });

  it('denies creating an item with seq, boardSeq or both', async () => {
    for (const [id, extra] of [
      ['a', { seq: 1 }],
      ['b', { boardSeq: 1 }],
      ['c', { seq: 1, boardSeq: 1 }],
    ] as const) {
      await assertFails(setDoc(itemRef(USERS.member, id), newItem(USERS.member, extra)));
    }
  });

  it('denies changing or removing either field, even for the board owner', async () => {
    for (const uid of [USERS.owner, USERS.member]) {
      for (const field of ['seq', 'boardSeq']) {
        const audit = { updatedAt: serverTimestamp(), updatedBy: uid };
        await assertFails(updateDoc(itemRef(uid), { [field]: 99, ...audit }));
        await assertFails(updateDoc(itemRef(uid), { [field]: deleteField(), ...audit }));
      }
    }
  });

  it('denies adding them to an item that has none', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'boards', MAIN_BOARD, 'items', 'plain'), itemDoc());
    });
    await assertFails(
      updateDoc(itemRef(USERS.member, 'plain'), {
        seq: 1,
        updatedAt: serverTimestamp(),
        updatedBy: USERS.member,
      }),
    );
  });

  it('denies smuggling them in through an updatesCount bump', async () => {
    await assertFails(updateDoc(itemRef(USERS.member), { updatesCount: 1, seq: 99 }));
    await assertFails(updateDoc(itemRef(USERS.member), { updatesCount: 1, boardSeq: 99 }));
    await assertSucceeds(updateDoc(itemRef(USERS.member), { updatesCount: increment(1) }));
  });

  it('still allows normal edits of an item that already has seq', async () => {
    const uid = USERS.member;
    await assertSucceeds(
      updateDoc(itemRef(uid), { name: 'Renamed', updatedAt: serverTimestamp(), updatedBy: uid }),
    );
    await assertSucceeds(
      updateDoc(
        itemRef(uid),
        new FieldPath('values', 'note'),
        'hello',
        'updatedAt',
        serverTimestamp(),
        'updatedBy',
        uid,
      ),
    );
  });
});

describe('counter documents are Functions-only', () => {
  it('denies every read and write of both counters, for every role', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member]) {
      const global = doc(as(uid), 'counters', 'items');
      const board = doc(as(uid), 'boards', MAIN_BOARD, 'counters', 'items');
      await assertFails(getDoc(global));
      await assertFails(getDoc(board));
      await assertFails(setDoc(global, { next: 1 }));
      await assertFails(updateDoc(global, { next: 1 }));
      await assertFails(setDoc(board, { nextItem: 1, nextSubitem: 1 }));
      await assertFails(updateDoc(board, { nextItem: 1 }));
    }
  });

  it('denies unauthenticated access', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'counters', 'items')));
    await assertFails(setDoc(doc(anon, 'counters', 'items'), { next: 1 }));
  });
});
