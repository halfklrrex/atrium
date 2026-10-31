import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { MAIN_BOARD, PRIVATE_BOARD, USERS, createTestEnv, seedFixture } from './helpers';

/**
 * Column type changes keep a backup under `boards/{id}/columnSnapshots/{snapshotId}` (with value
 * chunks below it). Only Cloud Functions (Admin SDK, bypasses rules) read and write it.
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
    for (const board of [MAIN_BOARD, PRIVATE_BOARD]) {
      const snapshot = doc(db, 'boards', board, 'columnSnapshots', 'snap1');
      await setDoc(snapshot, {
        columnId: 'status',
        scope: 'columns',
        status: 'applied',
        valueCount: 1,
        chunkCount: 1,
        expiresAt: Date.now() + 1000,
      });
      await setDoc(doc(snapshot, 'chunks', '000000'), {
        index: 0,
        entries: [{ itemId: 'item1', value: 'secret old value' }],
      });
    }
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('columnSnapshots are Functions-only', () => {
  it('denies every read and write of snapshots and chunks, for every role', async () => {
    for (const uid of [USERS.owner, USERS.admin, USERS.member, USERS.viewer]) {
      const db = as(uid);
      for (const board of [MAIN_BOARD, PRIVATE_BOARD]) {
        const snapshot = doc(db, 'boards', board, 'columnSnapshots', 'snap1');
        const chunk = doc(snapshot, 'chunks', '000000');
        await assertFails(getDoc(snapshot));
        await assertFails(getDoc(chunk));
        await assertFails(getDocs(collection(db, 'boards', board, 'columnSnapshots')));
        await assertFails(getDocs(collection(snapshot, 'chunks')));
        await assertFails(
          setDoc(doc(db, 'boards', board, 'columnSnapshots', 'new'), { status: 'ready' }),
        );
        await assertFails(updateDoc(snapshot, { status: 'reverted' }));
        await assertFails(deleteDoc(snapshot));
        await assertFails(setDoc(doc(snapshot, 'chunks', '000001'), { index: 1, entries: [] }));
        await assertFails(updateDoc(chunk, { entries: [] }));
        await assertFails(deleteDoc(chunk));
      }
    }
  });

  it('denies unauthenticated access', async () => {
    const anon = env.unauthenticatedContext().firestore();
    const snapshot = doc(anon, 'boards', MAIN_BOARD, 'columnSnapshots', 'snap1');
    await assertFails(getDoc(snapshot));
    await assertFails(getDoc(doc(snapshot, 'chunks', '000000')));
    await assertFails(setDoc(doc(anon, 'boards', MAIN_BOARD, 'columnSnapshots', 'new'), { a: 1 }));
  });

  it('the Admin SDK path (rules disabled) still reads the data the tests seeded', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await assertSucceeds(
        getDoc(
          doc(
            ctx.firestore(),
            'boards',
            MAIN_BOARD,
            'columnSnapshots',
            'snap1',
            'chunks',
            '000000',
          ),
        ),
      );
      if (!snap.exists()) throw new Error('seed missing');
    });
  });
});
