import type { BoardRole, TimeTrackingValue, WorkspaceRole } from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import {
  clickButtonInTransaction,
  startTimeTrackingInTransaction,
  stopTimeTrackingInTransaction,
  type ActivityAppendData,
  type BoardData,
  type ColumnActionsTx,
  type ItemData,
} from './column-actions';

interface TestStore {
  board?: BoardData | null;
  workspaceRoles: Record<string, WorkspaceRole>;
  item?: ItemData | null;
  updatedValues?: { columnId: string; value: unknown; updatedBy: string };
  appendedActivities: Array<{ boardId: string; activity: ActivityAppendData }>;
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

  describe('clickButtonInTransaction', () => {
    it('appends an immutable activity record to boards/{id}/activity with column and item details', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: { ...baseItem, name: 'Ship v1.0' },
        appendedActivities: [],
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
      });

      expect(store.appendedActivities).toHaveLength(1);
      expect(store.appendedActivities[0]).toEqual({
        boardId: 'b_1',
        activity: {
          kind: 'button_clicked',
          itemId: 'item_1',
          columnId: 'col_btn',
          userId: 'u_member',
          createdAt: 'SERVER_TIMESTAMP',
          data: {
            itemName: 'Ship v1.0',
            columnLabel: 'Deploy',
            columnColor: '#579bfc',
          },
        },
      });
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
      expect(store.appendedActivities[0]?.activity.data.columnLabel).toBe('Click');
    });

    it('rejects button click if column is not a button or user is a viewer', async () => {
      const store: TestStore = {
        board: baseBoard,
        workspaceRoles: { u_member: 'member' },
        item: baseItem,
        appendedActivities: [],
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
});
