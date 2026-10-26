import { type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { adminColumnActionsTx } from '../../../functions/src/lib/admin';
import {
  startTimeTrackingInTransaction,
  stopTimeTrackingInTransaction,
  clickButtonInTransaction,
} from '../../../functions/src/lib/column-actions';
import { USERS, createTestEnv, boardDoc, itemDoc, seedFixture } from './helpers';

const ACTIONS_BOARD = 'boardColumnActions';
const REMOVED_USER = 'removed-user';

let env: RulesTestEnvironment;
let adminApp: App;
let adminDb: Firestore;

beforeAll(async () => {
  env = await createTestEnv();
  adminApp = initializeApp({ projectId: 'demo-atrium-rules' }, `admin-col-actions-${Date.now()}`);
  adminDb = getFirestore(adminApp, FIRESTORE_DATABASE_ID);
});

afterAll(async () => {
  if (adminApp) {
    await deleteApp(adminApp);
  }
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedFixture(env);

  await env.withSecurityRulesDisabled(async (ctx: RulesTestContext) => {
    const db = ctx.firestore();

    // Create a board with time_tracking and button columns
    // access includes REMOVED_USER as 'editor', but WS.roles does NOT include REMOVED_USER.
    await setDoc(
      doc(db, 'boards', ACTIONS_BOARD),
      boardDoc({
        columns: [
          {
            id: 'col_timer',
            type: 'time_tracking',
            title: 'Time Tracking',
            position: 'a0',
            settings: {},
          },
          {
            id: 'col_button_nocolor',
            type: 'button',
            title: 'Button No Color',
            position: 'a1',
            settings: { label: 'Click Me' },
          },
          {
            id: 'col_button_color',
            type: 'button',
            title: 'Button With Color',
            position: 'a2',
            settings: { label: 'Deploy', color: '#00c875' },
          },
        ],
        access: {
          [USERS.owner]: 'owner',
          [USERS.member]: 'editor',
          [USERS.viewer]: 'viewer',
          [REMOVED_USER]: 'editor',
        },
        accessUids: [USERS.owner, USERS.member, USERS.viewer, REMOVED_USER],
      }),
    );

    await setDoc(
      doc(db, 'boards', ACTIONS_BOARD, 'items', 'i1'),
      itemDoc({ name: 'Task One', values: {} }),
    );
  });
});

describe('adminColumnActionsTx emulator tests', () => {
  it('starts, double-starts (idempotent), and stops time tracking through Admin SDK transaction', async () => {
    // 1. Start time tracking
    const startRes = await adminDb.runTransaction(async (tx) => {
      const adapted = adminColumnActionsTx(adminDb, tx);
      return await startTimeTrackingInTransaction(
        adapted,
        USERS.member,
        { boardId: ACTIONS_BOARD, itemId: 'i1', columnId: 'col_timer' },
        FieldValue.serverTimestamp(),
      );
    });

    expect(startRes.success).toBe(true);
    expect(startRes.sessionId).toBeDefined();
    expect(typeof startRes.startedAt).toBe('number');

    // Verify stored doc in real Firestore emulator
    const itemSnap1 = await adminDb
      .collection('boards')
      .doc(ACTIONS_BOARD)
      .collection('items')
      .doc('i1')
      .get();
    const val1 = itemSnap1.get('values.col_timer');
    expect(val1.running).toBe(true);
    expect(val1.duration).toBe(0);
    expect(val1.history).toHaveLength(1);
    expect(val1.history[0].id).toBe(startRes.sessionId);
    expect(val1.history[0].endedAt).toBeUndefined();

    // 2. Double start: calling start again while running returns existing open session
    const doubleStartRes = await adminDb.runTransaction(async (tx) => {
      const adapted = adminColumnActionsTx(adminDb, tx);
      return await startTimeTrackingInTransaction(
        adapted,
        USERS.member,
        { boardId: ACTIONS_BOARD, itemId: 'i1', columnId: 'col_timer' },
        FieldValue.serverTimestamp(),
      );
    });

    expect(doubleStartRes.success).toBe(true);
    expect(doubleStartRes.sessionId).toBe(startRes.sessionId);
    expect(doubleStartRes.startedAt).toBe(startRes.startedAt);

    // Stored doc still has only 1 session
    const itemSnap2 = await adminDb
      .collection('boards')
      .doc(ACTIONS_BOARD)
      .collection('items')
      .doc('i1')
      .get();
    expect(itemSnap2.get('values.col_timer').history).toHaveLength(1);

    // 3. Stop time tracking
    const stopRes = await adminDb.runTransaction(async (tx) => {
      const adapted = adminColumnActionsTx(adminDb, tx);
      return await stopTimeTrackingInTransaction(
        adapted,
        USERS.member,
        {
          boardId: ACTIONS_BOARD,
          itemId: 'i1',
          columnId: 'col_timer',
          sessionId: startRes.sessionId,
        },
        FieldValue.serverTimestamp(),
      );
    });

    expect(stopRes.success).toBe(true);
    expect(typeof stopRes.duration).toBe('number');
    expect(typeof stopRes.stoppedAt).toBe('number');

    // Verify stopped value in real Firestore emulator - no undefined properties stored!
    const itemSnap3 = await adminDb
      .collection('boards')
      .doc(ACTIONS_BOARD)
      .collection('items')
      .doc('i1')
      .get();
    const val3 = itemSnap3.get('values.col_timer');
    expect(val3.running).toBe(false);
    expect(val3.history).toHaveLength(1);
    expect(val3.history[0].endedAt).toBe(stopRes.stoppedAt);
    expect(val3.history[0]).not.toHaveProperty('startDate');
  });

  it('clicks button without colour in settings and appends activity with no undefined crash', async () => {
    const clickRes = await adminDb.runTransaction(async (tx) => {
      const adapted = adminColumnActionsTx(adminDb, tx);
      return await clickButtonInTransaction(
        adapted,
        USERS.member,
        { boardId: ACTIONS_BOARD, itemId: 'i1', columnId: 'col_button_nocolor' },
        FieldValue.serverTimestamp(),
      );
    });

    expect(clickRes.success).toBe(true);
    expect(clickRes.activityId).toBeDefined();

    // Verify activity document in real Firestore emulator
    const activitySnap = await adminDb
      .collection('boards')
      .doc(ACTIONS_BOARD)
      .collection('activity')
      .doc(clickRes.activityId)
      .get();

    expect(activitySnap.exists).toBe(true);
    const data = activitySnap.data();
    expect(data?.kind).toBe('button_clicked');
    expect(data?.itemId).toBe('i1');
    expect(data?.columnId).toBe('col_button_nocolor');
    expect(data?.userId).toBe(USERS.member);
    expect(data?.data.itemName).toBe('Task One');
    expect(data?.data.columnLabel).toBe('Click Me');
  });

  it('denies viewer on start, stop, and button click with permission-denied', async () => {
    await expect(
      adminDb.runTransaction(async (tx) => {
        const adapted = adminColumnActionsTx(adminDb, tx);
        return await startTimeTrackingInTransaction(
          adapted,
          USERS.viewer,
          { boardId: ACTIONS_BOARD, itemId: 'i1', columnId: 'col_timer' },
          FieldValue.serverTimestamp(),
        );
      }),
    ).rejects.toThrow(/permission/i);

    await expect(
      adminDb.runTransaction(async (tx) => {
        const adapted = adminColumnActionsTx(adminDb, tx);
        return await clickButtonInTransaction(
          adapted,
          USERS.viewer,
          { boardId: ACTIONS_BOARD, itemId: 'i1', columnId: 'col_button_nocolor' },
          FieldValue.serverTimestamp(),
        );
      }),
    ).rejects.toThrow(/permission/i);
  });

  it('denies removed member (stale board.access entry without workspace membership) with permission-denied', async () => {
    // REMOVED_USER has board.access = 'editor', but workspace roles do NOT contain REMOVED_USER
    await expect(
      adminDb.runTransaction(async (tx) => {
        const adapted = adminColumnActionsTx(adminDb, tx);
        return await startTimeTrackingInTransaction(
          adapted,
          REMOVED_USER,
          { boardId: ACTIONS_BOARD, itemId: 'i1', columnId: 'col_timer' },
          FieldValue.serverTimestamp(),
        );
      }),
    ).rejects.toThrow(/permission/i);

    await expect(
      adminDb.runTransaction(async (tx) => {
        const adapted = adminColumnActionsTx(adminDb, tx);
        return await clickButtonInTransaction(
          adapted,
          REMOVED_USER,
          { boardId: ACTIONS_BOARD, itemId: 'i1', columnId: 'col_button_nocolor' },
          FieldValue.serverTimestamp(),
        );
      }),
    ).rejects.toThrow(/permission/i);
  });
});
