import type { BoardRole, ButtonAction, TimeTrackingValue, WorkspaceRole } from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import type { NewActivity } from './activity';
import {
  clickButtonInTransaction,
  runActionsInTransaction,
  startTimeTrackingInTransaction,
  stopTimeTrackingInTransaction,
  type BoardData,
  type ColumnActionsTx,
  type ItemData,
} from './column-actions';

interface TestStore {
  board?: BoardData | null;
  workspaceRoles: Record<string, WorkspaceRole>;
  item?: ItemData | null;
  updatedValues?: { columnId: string; value: unknown; updatedBy: string };
  itemUpdates: Array<{ patch: Record<string, unknown>; updatedBy: string }>;
  appendedActivities: Array<{ boardId: string; activity: NewActivity }>;
  /** Epoch ms of earlier clicks of col_btn on item_1 by u_member (the activity log). */
  recentClicksMs?: number[];
  currentTimeMs: number;
  generatedSessionId: string;
}

function createFakeTx(store: TestStore): ColumnActionsTx {
  return {
    async getBoard() {
      return store.board ?? null;
    },
    async getWorkspaceMemberRole(_wsId, uid) {
      return store.workspaceRoles[uid] ?? null;
    },
    async getItem() {
      return store.item ?? null;
    },
    updateItemValues(_boardId, _itemId, columnId, value, updatedBy) {
      store.updatedValues = { columnId, value, updatedBy };
    },
    updateItem(_boardId, _itemId, patch, updatedBy) {
      store.itemUpdates.push({ patch, updatedBy });
    },
    async hasRecentButtonClick(_b, _i, _c, _uid, sinceMs) {
      return (store.recentClicksMs ?? []).some((ms) => ms >= sinceMs);
    },
    async getMemberProfile(_wsId, uid) {
      return uid === 'u_member' ? { name: 'Avery Quinn', photoURL: null } : null;
    },
    async appendActivity(boardId, activity) {
      store.appendedActivities.push({ boardId, activity });
      return `act_${store.appendedActivities.length}`;
    },
    nowMs() {
      return store.currentTimeMs;
    },
    newSessionId() {
      return store.generatedSessionId;
    },
  };
}

describe('column-actions', () => {
  const baseBoard: BoardData = {
    kind: 'main',
    workspaceId: 'ws_1',
    access: { u_owner: 'owner' as BoardRole },
    columns: [
      { id: 'col_time', type: 'time_tracking', settings: {} },
      { id: 'col_btn', type: 'button', settings: { label: 'Deploy', color: '#579bfc' } },
      { id: 'col_text', type: 'text', settings: {} },
    ],
  };

  const baseItem: ItemData = {
    id: 'item_1',
    name: 'Build landing page',
    state: 'active',
    values: {},
  };

  describe('startTimeTrackingInTransaction', () => {
    it('starts a timer on an empty cell with server time and authenticated UID', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: { ...baseItem },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_123',
      };
      const tx = createFakeTx(store);

      const result = await startTimeTrackingInTransaction(
        tx,
        'u_member',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time', note: 'Writing tests' },
        'SERVER_TIMESTAMP',
      );

      expect(result).toEqual({
        success: true,
        sessionId: 'sess_123',
        startedAt: 1700000000000,
      });

      expect(store.updatedValues).toEqual({
        columnId: 'col_time',
        updatedBy: 'u_member',
        value: {
          duration: 0,
          running: true,
          startDate: 1700000000000,
          history: [
            {
              id: 'sess_123',
              startedAt: 1700000000000,
              duration: 0,
              userId: 'u_member',
              note: 'Writing tests',
            },
          ],
        },
      });
    });

    it('starts a timer preserving previously closed sessions', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: {
          ...baseItem,
          values: {
            col_time: {
              duration: 3600,
              running: false,
              history: [
                {
                  id: 'sess_prev',
                  startedAt: 1699990000000,
                  endedAt: 1699993600000,
                  duration: 3600,
                  userId: 'u_other',
                },
              ],
            },
          },
        },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_new',
      };
      const tx = createFakeTx(store);

      const result = await startTimeTrackingInTransaction(
        tx,
        'u_member',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
        'SERVER_TIMESTAMP',
      );

      expect(result.sessionId).toBe('sess_new');
      const val = store.updatedValues?.value as TimeTrackingValue;
      expect(val.duration).toBe(3600);
      expect(val.running).toBe(true);
      expect(val.history).toHaveLength(2);
    });

    it('returns existing open session if start is called while already running (idempotency)', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: {
          ...baseItem,
          values: {
            col_time: {
              duration: 0,
              running: true,
              startDate: 1699999000000,
              history: [
                { id: 'sess_open', startedAt: 1699999000000, duration: 0, userId: 'u_member' },
              ],
            },
          },
        },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_fail',
      };
      const tx = createFakeTx(store);

      const res = await startTimeTrackingInTransaction(
        tx,
        'u_member',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
        'SERVER_TIMESTAMP',
      );
      expect(res).toEqual({
        success: true,
        sessionId: 'sess_open',
        startedAt: 1699999000000,
      });
      expect(store.updatedValues).toBeUndefined();
    });

    it('rejects if board is not found or user is viewer', async () => {
      const store: TestStore = {
        board: null,
        workspaceRoles: {},
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_x',
      };
      const tx = createFakeTx(store);

      await expect(
        startTimeTrackingInTransaction(
          tx,
          'u_1',
          { boardId: 'b_missing', itemId: 'item_1', columnId: 'col_time' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(/not found/i);

      // Viewer rejection
      store.board = baseBoard;
      store.workspaceRoles = { u_viewer: 'viewer' };
      store.item = baseItem;

      await expect(
        startTimeTrackingInTransaction(
          tx,
          'u_viewer',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(HttpsError);
    });

    it('returns existing open session if start is called while already running (idempotency)', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: {
          ...baseItem,
          values: {
            col_time: {
              duration: 0,
              running: true,
              startDate: 1700000000000,
              history: [
                { id: 'sess_active', startedAt: 1700000000000, duration: 0, userId: 'u_member' },
              ],
            },
          },
        },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000050000,
        generatedSessionId: 'sess_new',
      };
      const tx = createFakeTx(store);

      const res = await startTimeTrackingInTransaction(
        tx,
        'u_member',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
        'SERVER_TIMESTAMP',
      );

      expect(res).toEqual({
        success: true,
        sessionId: 'sess_active',
        startedAt: 1700000000000,
      });
      // Does not create a new write or new session
      expect(store.updatedValues).toBeUndefined();
    });

    it('throws HttpsError resource-exhausted when 500 session cap is reached', async () => {
      const sessions = Array.from({ length: 500 }, (_, i) => ({
        id: `s_${i}`,
        startedAt: 1000 + i * 2000,
        endedAt: 2000 + i * 2000,
        duration: 1,
        userId: 'u_member',
      }));
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: {
          ...baseItem,
          values: {
            col_time: { duration: 500, running: false, history: sessions },
          },
        },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_overflow',
      };
      const tx = createFakeTx(store);

      await expect(
        startTimeTrackingInTransaction(
          tx,
          'u_member',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(HttpsError);
    });

    it('does not reset an invalid stored value to empty on start; returns failed-precondition', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: {
          ...baseItem,
          values: {
            col_time: { corrupted: true, duration: -999 },
          },
        },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_corrupt',
      };
      const tx = createFakeTx(store);

      await expect(
        startTimeTrackingInTransaction(
          tx,
          'u_member',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(/invalid/i);
      expect(store.updatedValues).toBeUndefined();
    });

    it('denies start if user was removed from workspace (stale board access entry)', async () => {
      const store: TestStore = {
        board: {
          ...baseBoard,
          access: { u_removed: 'owner' },
        },
        // Removed from workspace: no entry in workspaceRoles
        workspaceRoles: {},
        item: baseItem,
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_removed',
      };
      const tx = createFakeTx(store);

      await expect(
        startTimeTrackingInTransaction(
          tx,
          'u_removed',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(HttpsError);
    });

    it('denies start on a private board without explicit access', async () => {
      const store: TestStore = {
        board: {
          ...baseBoard,
          kind: 'private',
          access: {},
        },
        workspaceRoles: { u_owner: 'owner' },
        item: baseItem,
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_priv',
      };
      const tx = createFakeTx(store);

      await expect(
        startTimeTrackingInTransaction(
          tx,
          'u_owner',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(HttpsError);
    });

    it('rejects if column is not time_tracking or item is not active', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: { ...baseItem, state: 'archived' },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_x',
      };
      const tx = createFakeTx(store);

      // Archived item
      await expect(
        startTimeTrackingInTransaction(
          tx,
          'u_member',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(/non-active/i);

      // Non-time_tracking column
      store.item = baseItem;
      await expect(
        startTimeTrackingInTransaction(
          tx,
          'u_member',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_text' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(/not a time_tracking column/i);
    });
  });

  describe('stopTimeTrackingInTransaction', () => {
    it('stops an open timer, accumulates elapsed seconds, and updates duration', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: {
          ...baseItem,
          values: {
            col_time: {
              duration: 100,
              running: true,
              startDate: 1700000000000,
              history: [
                {
                  id: 'sess_prev',
                  startedAt: 1699990000000,
                  endedAt: 1699990100000,
                  duration: 100,
                  userId: 'u_member',
                },
                {
                  id: 'sess_open',
                  startedAt: 1700000000000,
                  duration: 0,
                  userId: 'u_member',
                },
              ],
            },
          },
        },
        appendedActivities: [],
        itemUpdates: [],
        // Stopped 120 seconds later
        currentTimeMs: 1700000120000,
        generatedSessionId: 'sess_none',
      };
      const tx = createFakeTx(store);

      const result = await stopTimeTrackingInTransaction(
        tx,
        'u_member',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
        'SERVER_TIMESTAMP',
      );

      expect(result).toEqual({
        success: true,
        duration: 220, // 100 + 120
        stoppedAt: 1700000120000,
      });

      const val = store.updatedValues?.value as TimeTrackingValue;
      expect(val.running).toBe(false);
      expect(val.startDate).toBeUndefined();
      expect(val.duration).toBe(220);
      expect(val.history![1]!.endedAt).toBe(1700000120000);
      expect(val.history![1]!.duration).toBe(120);
    });

    it('returns no-op success if stopping an already closed session with matching sessionId', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: {
          ...baseItem,
          values: {
            col_time: {
              duration: 45,
              running: false,
              history: [
                {
                  id: 'sess_done',
                  startedAt: 1700000000000,
                  endedAt: 1700000045000,
                  duration: 45,
                  userId: 'u_member',
                },
              ],
            },
          },
        },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000050000,
        generatedSessionId: 'sess_none',
      };
      const tx = createFakeTx(store);

      const result = await stopTimeTrackingInTransaction(
        tx,
        'u_member',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time', sessionId: 'sess_done' },
        'SERVER_TIMESTAMP',
      );

      expect(result).toEqual({
        success: true,
        duration: 45,
        stoppedAt: 1700000045000,
      });
      // No extra write performed
      expect(store.updatedValues).toBeUndefined();
    });

    it('rejects stopping if timer is not running and no sessionId is provided', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: {
          ...baseItem,
          values: {
            col_time: { duration: 0, running: false, history: [] },
          },
        },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_none',
      };
      const tx = createFakeTx(store);

      await expect(
        stopTimeTrackingInTransaction(
          tx,
          'u_member',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(/not currently running/i);
    });
  });

  describe('subitems share the board columns', () => {
    const subitem = { ...baseItem, id: 'sub_1', parentItemId: 'item_1' } as ItemData;
    const newStore = (): TestStore => ({
      board: baseBoard,
      workspaceRoles: { u_member: 'member' },
      item: subitem,
      appendedActivities: [],
      itemUpdates: [],
      currentTimeMs: 1700000000000,
      generatedSessionId: 'sess_sub',
    });

    it('starts a timer in a board time-tracking column on a subitem', async () => {
      const store = newStore();
      const result = await startTimeTrackingInTransaction(
        createFakeTx(store),
        'u_member',
        { boardId: 'b_1', itemId: 'sub_1', columnId: 'col_time' },
        'SERVER_TIMESTAMP',
      );
      expect(result).toMatchObject({ success: true, sessionId: 'sess_sub' });
      expect(store.updatedValues?.columnId).toBe('col_time');
    });

    it('presses a board button column on a subitem', async () => {
      const store = newStore();
      const result = await clickButtonInTransaction(
        createFakeTx(store),
        'u_member',
        { boardId: 'b_1', itemId: 'sub_1', columnId: 'col_btn' },
        'SERVER_TIMESTAMP',
      );
      expect(result).toMatchObject({ success: true });
      expect(store.appendedActivities).toHaveLength(1);
    });
  });

  describe('clickButtonInTransaction', () => {
    it('appends an immutable activity record to boards/{id}/activity with column and item details', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: { ...baseItem, name: 'Ship v1.0' },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_none',
      };
      const tx = createFakeTx(store);

      const result = await clickButtonInTransaction(
        tx,
        'u_member',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_btn' },
        'SERVER_TIMESTAMP',
      );

      expect(result).toEqual({
        success: true,
        activityId: 'act_1',
        timestamp: 1700000000000,
        applied: [],
      });
      expect(store.itemUpdates).toEqual([]);

      expect(store.appendedActivities).toHaveLength(1);
      expect(store.appendedActivities[0]).toEqual({
        boardId: 'b_1',
        activity: {
          kind: 'button_clicked',
          actorId: 'u_member',
          actorName: 'Avery Quinn',
          actorPhotoUrl: null,
          itemId: 'item_1',
          itemName: 'Ship v1.0',
          parentItemId: null,
          columnId: 'col_btn',
          columnTitle: 'Deploy',
          columnType: 'button',
          groupId: null,
          groupTitle: null,
          data: { columnColor: '#579bfc' },
        },
      });
    });

    it('logs nothing when the click is refused', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_viewer: 'viewer' },
        item: baseItem,
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1,
        generatedSessionId: 's',
      };
      await expect(
        clickButtonInTransaction(
          createFakeTx(store),
          'u_viewer',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_btn' },
          'TS',
        ),
      ).rejects.toThrow();
      expect(store.appendedActivities).toEqual([]);
    });

    it('appends activity record using default button settings when settings have no color', async () => {
      const boardWithoutColor: BoardData = {
        ...baseBoard,
        columns: [{ id: 'col_btn_nocolor', type: 'button', settings: {} }],
      };
      const store: TestStore = {
        board: boardWithoutColor,
        workspaceRoles: { u_member: 'member' },
        item: { ...baseItem, name: 'Task without color' },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_none',
      };
      const tx = createFakeTx(store);

      const result = await clickButtonInTransaction(
        tx,
        'u_member',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_btn_nocolor' },
        'SERVER_TIMESTAMP',
      );

      expect(result.success).toBe(true);
      expect(store.appendedActivities[0]?.activity.data.columnColor).toBe('#579bfc');
      expect(store.appendedActivities[0]?.activity.columnTitle).toBe('Click');
    });

    it('rejects button click if column is not a button or user is a viewer', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: baseItem,
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_none',
      };
      const tx = createFakeTx(store);

      // Wrong column type
      await expect(
        clickButtonInTransaction(
          tx,
          'u_member',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_text' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(/not a button column/i);

      // Viewer role
      store.workspaceRoles = { u_viewer: 'viewer' };
      await expect(
        clickButtonInTransaction(
          tx,
          'u_viewer',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_btn' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toThrow(HttpsError);
    });
  });

  describe('column locks enforcement', () => {
    const lockedBoard: BoardData = {
      ...baseBoard,
      columnLocks: ['col_time', 'col_btn'],
    };

    it('refuses startTimeTracking, stopTimeTracking, and clickButton for an editor on a locked column and allows a board owner', async () => {
      const store: TestStore = {
        board: lockedBoard,
        workspaceRoles: { u_member: 'member', u_owner: 'owner' },
        item: { ...baseItem },
        appendedActivities: [],
        itemUpdates: [],
        currentTimeMs: 1700000000000,
        generatedSessionId: 'sess_lock',
      };
      const tx = createFakeTx(store);

      // Editor is refused on startTimeTracking
      await expect(
        startTimeTrackingInTransaction(
          tx,
          'u_member',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toMatchObject({
        code: 'permission-denied',
        message: 'This column is locked. Only board owners can edit it.',
      });

      // Owner can start timer on locked column
      const startRes = await startTimeTrackingInTransaction(
        tx,
        'u_owner',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
        'SERVER_TIMESTAMP',
      );
      expect(startRes.success).toBe(true);
      store.item = {
        ...baseItem,
        values: { col_time: store.updatedValues?.value },
      };

      // Editor is refused on stopTimeTracking
      store.currentTimeMs = 1700000060000;
      await expect(
        stopTimeTrackingInTransaction(
          tx,
          'u_member',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toMatchObject({
        code: 'permission-denied',
        message: 'This column is locked. Only board owners can edit it.',
      });

      // Owner can stop timer on locked column
      const stopRes = await stopTimeTrackingInTransaction(
        tx,
        'u_owner',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_time' },
        'SERVER_TIMESTAMP',
      );
      expect(stopRes.success).toBe(true);

      // Editor is refused on clickButton
      await expect(
        clickButtonInTransaction(
          tx,
          'u_member',
          { boardId: 'b_1', itemId: 'item_1', columnId: 'col_btn' },
          'SERVER_TIMESTAMP',
        ),
      ).rejects.toMatchObject({
        code: 'permission-denied',
        message: 'This column is locked. Only board owners can edit it.',
      });

      // Owner can click locked button column
      const clickRes = await clickButtonInTransaction(
        tx,
        'u_owner',
        { boardId: 'b_1', itemId: 'item_1', columnId: 'col_btn' },
        'SERVER_TIMESTAMP',
      );
      expect(clickRes.success).toBe(true);
    });
  });

  describe('clickButtonInTransaction actions', () => {
    const actionsBoard = (actions: unknown[], extra: Partial<BoardData> = {}): BoardData =>
      ({
        ...baseBoard,
        columns: [
          { id: 'col_btn', type: 'button', settings: { label: 'Ship', color: '#579bfc', actions } },
          { id: 'col_text', type: 'text', settings: {} },
          { id: 'col_other', type: 'text', settings: {} },
        ],
        groups: [{ id: 'g_done' }, { id: 'g_todo' }],
        ...extra,
      }) as BoardData;

    const makeStore = (board: BoardData, item: ItemData = baseItem): TestStore => ({
      board,
      workspaceRoles: { u_member: 'member', u_owner: 'owner', u_viewer: 'viewer' },
      item,
      appendedActivities: [],
      itemUpdates: [],
      currentTimeMs: Date.UTC(2026, 10, 3, 12),
      generatedSessionId: 's',
    });
    const req = { boardId: 'b_1', itemId: 'item_1', columnId: 'col_btn' };
    const click = (store: TestStore, uid = 'u_member') =>
      clickButtonInTransaction(createFakeTx(store), uid, req, 'TS');

    it('applies every action type in one patch with the clicking user', async () => {
      const store = makeStore(
        actionsBoard([
          { type: 'set_value', columnId: 'col_text', value: 'Shipped' },
          { type: 'rename_item', template: '{name} ({date})' },
          { type: 'move_to_group', groupId: 'g_done' },
          { type: 'archive_item' },
        ]),
      );
      const result = await click(store);
      expect(store.itemUpdates).toEqual([
        {
          updatedBy: 'u_member',
          patch: {
            'values.col_text': 'Shipped',
            name: 'Build landing page (2026-11-03)',
            groupId: 'g_done',
            state: 'archived',
          },
        },
      ]);
      expect(result.applied.map((a) => a.type)).toEqual([
        'set_value',
        'rename_item',
        'move_to_group',
        'archive_item',
      ]);
      expect(store.appendedActivities[0]?.activity.data.actions).toEqual([
        'set_value',
        'rename_item',
        'move_to_group',
        'archive_item',
      ]);
    });

    it('runs in order, the last write to a column wins, null clears, unknown tokens stay', async () => {
      const store = makeStore(
        actionsBoard([
          { type: 'set_value', columnId: 'col_text', value: 'one' },
          { type: 'set_value', columnId: 'col_text', value: 'two' },
          { type: 'set_value', columnId: 'col_other', value: null },
          { type: 'rename_item', template: '{name}!' },
          { type: 'rename_item', template: '{name} {x}' },
        ]),
      );
      await click(store);
      expect(store.itemUpdates[0]?.patch).toEqual({
        'values.col_text': 'two',
        'values.col_other': null,
        name: 'Build landing page! {x}',
      });
    });

    it('is all or nothing: a bad second action writes and logs nothing', async () => {
      const store = makeStore(
        actionsBoard([
          { type: 'set_value', columnId: 'col_text', value: 'x' },
          { type: 'move_to_group', groupId: 'g_gone' },
        ]),
      );
      await expect(click(store)).rejects.toMatchObject({
        code: 'failed-precondition',
        message: 'Action 2 (Move to group): the group no longer exists',
      });
      expect(store.itemUpdates).toEqual([]);
      expect(store.appendedActivities).toEqual([]);
    });

    it('refuses invalid values, button, missing and a rename that ends empty', async () => {
      for (const action of [
        { type: 'set_value', columnId: 'col_text', value: 42 },
        { type: 'set_value', columnId: 'col_btn', value: {} },
        { type: 'set_value', columnId: 'col_gone', value: 'x' },
        { type: 'rename_item', template: '   ' },
      ]) {
        const store = makeStore(actionsBoard([action]));
        await expect(click(store)).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(store.itemUpdates).toEqual([]);
      }
    });

    it('refuses an editor on a locked target column and allows an owner', async () => {
      const board = actionsBoard([{ type: 'set_value', columnId: 'col_text', value: 'x' }], {
        columnLocks: ['col_text'],
      });
      const store = makeStore(board);
      await expect(click(store, 'u_member')).rejects.toMatchObject({
        code: 'failed-precondition',
      });
      expect(store.itemUpdates).toEqual([]);
      await click(store, 'u_owner');
      expect(store.itemUpdates).toHaveLength(1);
    });

    it('refuses a viewer and an archived item', async () => {
      const board = actionsBoard([{ type: 'archive_item' }]);
      const viewer = makeStore(board);
      await expect(click(viewer, 'u_viewer')).rejects.toMatchObject({ code: 'permission-denied' });
      const archived = makeStore(board, { ...baseItem, state: 'archived' });
      await expect(click(archived)).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(viewer.itemUpdates).toEqual([]);
      expect(archived.itemUpdates).toEqual([]);
    });

    describe('notify', () => {
      const notifyAction = {
        type: 'notify',
        uids: ['u_owner', 'u_viewer'],
        message: ' Please look ',
      };

      it('returns the plan, never writes to the item for it, and records no count yet', async () => {
        const store = makeStore(
          actionsBoard([
            { type: 'rename_item', template: 'Shipped {name}' },
            notifyAction,
            { type: 'notify', uids: ['u_viewer', 'u_member'] },
          ]),
        );
        const result = await click(store);
        expect(store.itemUpdates[0]?.patch).toEqual({ name: 'Shipped Build landing page' });
        expect(result.notify).toEqual({
          columnId: 'col_btn',
          buttonLabel: 'Ship',
          itemName: 'Shipped Build landing page',
          // one entry per person, the later action's message wins
          targets: [
            { uid: 'u_owner', message: 'Please look' },
            { uid: 'u_viewer', message: '' },
            { uid: 'u_member', message: '' },
          ],
        });
        expect(result.applied.map((a) => a.type)).toEqual(['rename_item', 'notify', 'notify']);
        expect(store.appendedActivities[0]?.activity.data.actions).toEqual([
          'rename_item',
          'notify',
          'notify',
        ]);
      });

      it('a notify-only button writes nothing to the item', async () => {
        const store = makeStore(actionsBoard([notifyAction]));
        const result = await click(store);
        expect(store.itemUpdates).toEqual([]);
        expect(result.notify?.targets).toHaveLength(2);
      });

      it('has no plan without a notify action', async () => {
        const store = makeStore(actionsBoard([{ type: 'archive_item' }]));
        expect((await click(store)).notify).toBeUndefined();
      });

      it('plans nothing and writes nothing when a later action fails', async () => {
        const store = makeStore(
          actionsBoard([notifyAction, { type: 'move_to_group', groupId: 'missing' }]),
        );
        await expect(click(store)).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(store.itemUpdates).toEqual([]);
        expect(store.appendedActivities).toEqual([]);
      });

      it('refuses a repeat click inside 2 seconds with already-exists and no writes', async () => {
        const store = makeStore(actionsBoard([notifyAction, { type: 'archive_item' }]));
        store.recentClicksMs = [store.currentTimeMs - 1500];
        await expect(click(store)).rejects.toMatchObject({ code: 'already-exists' });
        expect(store.itemUpdates).toEqual([]);
        expect(store.appendedActivities).toEqual([]);
        store.recentClicksMs = [store.currentTimeMs - 2500];
        await expect(click(store)).resolves.toMatchObject({ success: true });
      });
    });
  });
});

describe('runActionsInTransaction', () => {
  const board: BoardData = {
    kind: 'main',
    workspaceId: 'ws_1',
    access: {},
    columns: [{ id: 'col_text', type: 'text', settings: {} }],
    groups: [{ id: 'g1' }, { id: 'g2' }],
  };
  const item: ItemData = { id: 'item_1', name: 'Task', state: 'active', values: {} };
  const newStore = (): TestStore => ({
    board,
    workspaceRoles: {},
    item,
    appendedActivities: [],
    itemUpdates: [],
    currentTimeMs: 1700000000000,
    generatedSessionId: 's',
  });
  const ctx = (over: Partial<Parameters<typeof runActionsInTransaction>[1]> = {}) => ({
    boardId: 'b_1',
    item,
    actions: [
      { type: 'set_value' as const, columnId: 'col_text', value: 'hi' },
      { type: 'move_to_group' as const, groupId: 'g2' },
    ],
    board,
    role: 'editor' as BoardRole,
    actorUid: 'automation-runner',
    nowMs: 1700000000000,
    ...over,
  });

  it('applies the patch with the extra item fields and reports applied types', async () => {
    const store = newStore();
    const out = await runActionsInTransaction(
      createFakeTx(store),
      ctx({ extraItemFields: { updatedVia: 'automation:abc', automationDepth: 1 } }),
      'TS',
    );
    expect(out).toEqual({ applied: ['set_value', 'move_to_group'] });
    expect(store.itemUpdates).toEqual([
      {
        patch: {
          'values.col_text': 'hi',
          groupId: 'g2',
          updatedVia: 'automation:abc',
          automationDepth: 1,
        },
        updatedBy: 'automation-runner',
      },
    ]);
  });

  it('skips a non-active item without writing', async () => {
    const store = newStore();
    const out = await runActionsInTransaction(
      createFakeTx(store),
      ctx({ item: { ...item, state: 'archived' } }),
      'TS',
    );
    expect(out).toEqual({ skipped: 'item not active' });
    expect(store.itemUpdates).toEqual([]);
  });

  it('checks notify targets against board.memberUids when given', async () => {
    const actions = [{ type: 'notify' as const, uids: ['u_x'], message: 'hey' }];
    await expect(
      runActionsInTransaction(
        createFakeTx(newStore()),
        ctx({ actions, board: { ...board, memberUids: ['u_y'] } }),
        'TS',
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    const ok = await runActionsInTransaction(
      createFakeTx(newStore()),
      ctx({
        actions,
        board: { ...board, memberUids: ['u_x'] },
        notifyColumnId: 'c',
        notifyLabel: 'L',
      }),
      'TS',
    );
    expect(ok).toMatchObject({
      applied: ['notify'],
      notify: { columnId: 'c', buttonLabel: 'L', targets: [{ uid: 'u_x', message: 'hey' }] },
    });
  });
});

describe('runActionsInTransaction: required columns (REQ-2)', () => {
  const labels = [
    { id: 'w', index: 0, label: 'Working', color: '#fdab3d' },
    { id: 'd', index: 1, label: 'Done', color: '#00c875', isDone: true },
  ];
  const board: BoardData = {
    kind: 'main',
    workspaceId: 'ws_1',
    access: {},
    columns: [
      { id: 'st', type: 'status', title: 'Status', settings: { labels } },
      { id: 'notes', type: 'text', title: 'Notes', settings: {}, required: true },
    ],
    groups: [{ id: 'g1' }],
  };
  const item = (values: Record<string, unknown>): ItemData => ({
    id: 'item_1',
    name: 'Task',
    state: 'active',
    values,
  });
  const run = async (actions: ButtonAction[], values: Record<string, unknown>) => {
    const store: TestStore = {
      board,
      workspaceRoles: {},
      item: item(values),
      appendedActivities: [],
      itemUpdates: [],
      currentTimeMs: 1700000000000,
      generatedSessionId: 's',
    };
    const out = runActionsInTransaction(
      createFakeTx(store),
      {
        boardId: 'b_1',
        item: item(values),
        actions,
        board,
        role: 'editor' as BoardRole,
        actorUid: 'u1',
        nowMs: 1700000000000,
      },
      'TS',
    );
    return { out, store };
  };

  it('refuses a set_value that empties a required cell and writes nothing', async () => {
    const { out, store } = await run([{ type: 'set_value', columnId: 'notes', value: '' }], {
      notes: 'x',
    });
    await expect(out).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('Notes'),
    });
    expect(store.itemUpdates).toEqual([]);
  });

  it('refuses Done while a required cell is empty, and allows it once filled', async () => {
    const done: ButtonAction[] = [{ type: 'set_value', columnId: 'st', value: { index: 1 } }];
    const blocked = await run(done, { st: { index: 0 } });
    await expect(blocked.out).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('Notes'),
    });
    expect(blocked.store.itemUpdates).toEqual([]);

    const ok = await run(done, { st: { index: 0 }, notes: 'filled' });
    await expect(ok.out).resolves.toMatchObject({ applied: ['set_value'] });
  });

  it('does not touch an item that was already Done or a patch without values', async () => {
    const rename = await run([{ type: 'move_to_group', groupId: 'g1' }], {});
    await expect(rename.out).resolves.toMatchObject({ applied: ['move_to_group'] });
    const again = await run([{ type: 'set_value', columnId: 'st', value: { index: 1 } }], {
      st: { index: 1 },
    });
    await expect(again.out).resolves.toMatchObject({ applied: ['set_value'] });
  });
});
