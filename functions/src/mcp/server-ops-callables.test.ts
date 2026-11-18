import { McpUserError } from '@atrium/mcp-core';
import type { BoardRole, ColumnDef, TimeTrackingValue, WorkspaceRole } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import type { ColumnActionsTx } from '../lib/column-actions';
import type { ColumnTypeChangeStore, SnapshotMeta } from '../lib/column-type-change';
import { createServerOps } from './server-ops';

const OWNER = 'u_owner';
const EDITOR = 'u_editor';
const VIEWER = 'u_viewer';

/** A column type change store that only knows a board and its items (no snapshot is ever written). */
function typeStore(columns: ColumnDef[], values: Record<string, unknown>) {
  const snapshots = new Map<string, SnapshotMeta>();
  const roles: Record<string, WorkspaceRole> = {
    [OWNER]: 'owner',
    [EDITOR]: 'member',
    [VIEWER]: 'viewer',
  };
  const writes: string[] = [];
  const store = {
    getBoard: async () => ({
      kind: 'main' as const,
      workspaceId: 'ws_1',
      access: { [OWNER]: 'owner', [EDITOR]: 'editor', [VIEWER]: 'viewer' } as Record<
        string,
        BoardRole
      >,
      columns,
      subitemColumns: [],
      columnLocks: [],
    }),
    getWorkspaceMemberRole: async (_w: string, uid: string) => roles[uid] ?? null,
    getMemberNames: async () => ({}),
    listItems: async () =>
      Object.entries(values).map(([id, value]) => ({
        id,
        parentItemId: null,
        values: { budget: value },
        meta: {},
      })),
    getSnapshot: async (_b: string, id: string) => snapshots.get(id) ?? null,
    setSnapshot: async (_b: string, id: string, meta: SnapshotMeta) => {
      writes.push('setSnapshot');
      snapshots.set(id, meta);
    },
    deleteSnapshotChunks: async () => {
      writes.push('deleteChunks');
    },
    writeSnapshotChunk: async () => {
      writes.push('writeChunk');
    },
    readSnapshotChunks: async () => [],
    updateColumn: async () => {
      writes.push('updateColumn');
    },
    writeValues: async () => {
      writes.push('writeValues');
    },
    nowMs: () => 1_000_000,
    newId: () => 'snap_1',
  } satisfies ColumnTypeChangeStore;
  return { store, writes };
}

class FakeActions {
  value: unknown = undefined;
  state = 'active';
  stamps: unknown[] = [];
  updated: Array<{ columnId: string; value: unknown; by: string }> = [];
  tx(): ColumnActionsTx {
    return {
      getBoard: async () => ({
        kind: 'main',
        workspaceId: 'ws_1',
        access: { [OWNER]: 'owner', [EDITOR]: 'editor' } as Record<string, BoardRole>,
        columns: [{ id: 'col_time', type: 'time_tracking', settings: {} }],
        columnLocks: [],
      }),
      getWorkspaceMemberRole: async (_w: string, uid: string) =>
        (
          ({ [OWNER]: 'owner', [EDITOR]: 'member', [VIEWER]: 'viewer' }) as Record<
            string,
            WorkspaceRole
          >
        )[uid] ?? null,
      getItem: async () => ({
        id: 'i_1',
        name: 'Task',
        state: this.state as 'active',
        values: this.value === undefined ? {} : { col_time: this.value },
      }),
      updateItemValues: (_b: string, _i: string, columnId: string, value: unknown, by: string) => {
        this.updated.push({ columnId, value, by });
        this.value = value;
      },
      nowMs: () => 5_000_000,
      newSessionId: () => 'sess_1',
    } as unknown as ColumnActionsTx;
  }
}

const budget = (type = 'text'): ColumnDef => ({
  id: 'budget',
  type,
  title: 'Budget',
  position: 'a0',
  settings: {},
});

function setup(columns: ColumnDef[] = [budget()], values: Record<string, unknown> = {}) {
  const { store, writes } = typeStore(columns, values);
  const actions = new FakeActions();
  const clicks: unknown[] = [];
  const ops = createServerOps({
    runTransaction: async () => {
      throw new Error('unused');
    },
    bucket: {} as never,
    putObject: async () => undefined,
    runSharing: async () => {
      throw new Error('unused');
    },
    columnTypeStore: store,
    runColumnActions: (fn) => fn(actions.tx(), 'SERVER_TIME'),
    clickButton: async (uid, request) => {
      clicks.push({ uid, ...request });
      return {
        success: true as const,
        activityId: 'act_1',
        timestamp: 7,
        applied: [{ type: 'notify' as const }],
        notified: 1,
      };
    },
  });
  return { ops, writes, actions, clicks };
}

const args = { uid: OWNER, boardId: 'b_1', columnId: 'budget', toType: 'numbers', toSettings: {} };

describe('previewColumnTypeChange', () => {
  it('reports converted and lost values without writing anything', async () => {
    const { ops, writes } = setup([budget()], { a: '5', b: 'n/a', c: '7' });
    const preview = await ops.previewColumnTypeChange(args);
    expect(preview).toMatchObject({
      fromType: 'text',
      toType: 'numbers',
      converted: 2,
      cleared: 1,
    });
    expect(preview.lost).toEqual([{ itemId: 'b', before: 'n/a' }]);
    expect(preview.samples.length).toBeGreaterThan(0);
    expect(writes).toEqual([]);
  });

  it('refuses viewers, an unsupported pair and a locked column like the callable', async () => {
    const { ops } = setup([budget()], { a: '5' });
    await expect(ops.previewColumnTypeChange({ ...args, uid: VIEWER })).rejects.toThrow(
      McpUserError,
    );
    await expect(ops.previewColumnTypeChange({ ...args, toType: 'files' })).rejects.toThrow(
      /filled in by Atrium/,
    );
    await expect(ops.previewColumnTypeChange({ ...args, toType: 'text' })).rejects.toThrow(
      /already has this type/,
    );
    await expect(ops.previewColumnTypeChange({ ...args, columnId: 'nope' })).rejects.toThrow(
      /Column not found/,
    );
  });

  it('refuses a column that is being converted', async () => {
    const busy = {
      ...budget(),
      migrating: { snapshotId: 's', startedAt: 999_999, kind: 'change' as const },
    };
    const { ops } = setup([busy], { a: '5' });
    await expect(ops.previewColumnTypeChange(args)).rejects.toThrow(/being converted/);
  });
});

describe('changeColumnType and revertColumnType', () => {
  it('turn a library HttpsError into a McpUserError for the caller', async () => {
    const { ops } = setup([budget()], { a: '5' });
    await expect(ops.changeColumnType({ ...args, uid: VIEWER })).rejects.toBeInstanceOf(
      McpUserError,
    );
    await expect(
      ops.revertColumnType({ uid: OWNER, boardId: 'b_1', snapshotId: 'missing' }),
    ).rejects.toThrow(/can no longer be undone/);
  });
});

describe('clickButton', () => {
  it('runs the callable code as the actor and drops the success flag', async () => {
    const { ops, clicks } = setup();
    const out = await ops.clickButton({
      uid: EDITOR,
      boardId: 'b_1',
      itemId: 'i_1',
      columnId: 'col_btn',
    });
    expect(clicks).toEqual([{ uid: EDITOR, boardId: 'b_1', itemId: 'i_1', columnId: 'col_btn' }]);
    expect(out).toEqual({
      activityId: 'act_1',
      timestamp: 7,
      applied: [{ type: 'notify' }],
      notified: 1,
    });
  });
});

describe('time tracking', () => {
  const request = { uid: EDITOR, boardId: 'b_1', itemId: 'i_1', columnId: 'col_time' };

  it('starts a timer as the actor, then stops it with the total in seconds', async () => {
    const { ops, actions } = setup();
    const started = await ops.startTimeTracking(request);
    expect(started).toEqual({ sessionId: 'sess_1', startedAt: 5_000_000 });
    expect(actions.updated[0]).toMatchObject({ columnId: 'col_time', by: EDITOR });
    const value = actions.value as TimeTrackingValue;
    expect(value.running).toBe(true);
    const stopped = await ops.stopTimeTracking(request);
    expect(stopped.stoppedAt).toBe(5_000_000);
    expect(stopped.duration).toBe(0);
    expect((actions.value as TimeTrackingValue).running).toBe(false);
  });

  it('start is repeatable and stop refuses when nothing runs', async () => {
    const { ops } = setup();
    await expect(ops.stopTimeTracking(request)).rejects.toThrow(/not currently running/);
    const first = await ops.startTimeTracking(request);
    const again = await ops.startTimeTracking(request);
    expect(again.sessionId).toBe(first.sessionId);
  });

  it('refuses viewers and archived items', async () => {
    const { ops, actions } = setup();
    await expect(ops.startTimeTracking({ ...request, uid: VIEWER })).rejects.toBeInstanceOf(
      McpUserError,
    );
    actions.state = 'archived';
    await expect(ops.startTimeTracking(request)).rejects.toThrow(/non-active item/);
  });
});
