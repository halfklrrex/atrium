import {
  type BoardKind,
  type BoardRole,
  type ChangeColumnTypeRequest,
  type ChangeColumnTypeResult,
  type ColumnDef,
  type ColumnScope,
  type ColumnSnapshotStatus,
  type RevertColumnTypeRequest,
  type RevertColumnTypeResult,
  type WorkspaceRole,
  COLUMN_LOCKED_MESSAGE,
  COLUMN_MIGRATION_CHUNK_SIZE,
  COLUMN_MIGRATION_STALE_MS,
  COLUMN_SNAPSHOT_CHUNK_MAX_CHARS,
  COLUMN_SNAPSHOT_TTL_MS,
  canEditBoard,
  canEditColumn,
  columnRegistry,
  columnTypeChangeSupport,
  planColumnConversion,
  resolveBoardRole,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * `changeColumnType` and `revertColumnType` (P2 "Change a column's type", spec
 * docs/specs/P2-change-column-type.md). Server-side so the migration is consistent and undoable.
 *
 * Order of every change, and why it is safe to die between any two steps and run again:
 *  1. validate (permissions, locks, target settings)
 *  2. snapshot: the old column def and every old value go to `columnSnapshots/{id}` (chunked), and the
 *     snapshot is READ BACK and counted before it is marked `ready`
 *  3. mark the column `migrating` (the web shows its cells read-only)
 *  4. write the converted values, 400 per batch (nothing is written before step 2 is verified)
 *  5. in one transaction: set the new type and settings, clear `migrating`, mark the snapshot applied
 * Every step after 1 is derived from the snapshot, so a second run produces the same writes.
 * Client edits made while step 4 runs can race with it (the migration takes seconds); a value written
 * after the snapshot is not part of it and is left as it is (the web shows an invalid value as empty).
 */

export interface ChangeBoardData {
  kind: BoardKind;
  workspaceId: string;
  access: Record<string, BoardRole>;
  columns: ColumnDef[];
  subitemColumns: ColumnDef[];
  columnLocks?: string[];
}

/** An item as the migration sees it (all states; `parentItemId` decides which column list it uses). */
export interface MigrationItem {
  id: string;
  parentItemId: string | null;
  values: Record<string, unknown>;
  meta: {
    createdAt?: unknown;
    createdBy?: string;
    updatedAt?: unknown;
    updatedBy?: string;
    groupId?: string;
    seq?: number;
    boardSeq?: number;
  };
}

export interface SnapshotEntry {
  itemId: string;
  value: unknown;
}

/** `boards/{id}/columnSnapshots/{snapshotId}`, Functions-only. Times are epoch milliseconds. */
export interface SnapshotMeta {
  columnId: string;
  scope: ColumnScope;
  /** The column def before the change; revert puts its `type`, `settings` and `defaultValue` back. */
  fromColumn: ColumnDef;
  toType: string;
  /** The requested (validated) target settings; labels the conversion creates are added later. */
  toSettings: Record<string, unknown>;
  status: ColumnSnapshotStatus;
  valueCount: number;
  chunkCount: number;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  appliedAt?: number;
  revertedAt?: number;
}

/** Remove the cell: `values.<id>` is deleted instead of set. */
export const DELETE_VALUE = Symbol('delete-value');
export interface ValueWrite {
  itemId: string;
  value: unknown | typeof DELETE_VALUE;
}

export interface ColumnTypeChangeStore {
  getBoard(boardId: string): Promise<ChangeBoardData | null>;
  getWorkspaceMemberRole(workspaceId: string, uid: string): Promise<WorkspaceRole | null>;
  /** Display names of the workspace members by uid (for converting People to text). */
  getMemberNames(workspaceId: string): Promise<Record<string, string>>;
  /** Every item of the board, in a stable order. */
  listItems(boardId: string): Promise<MigrationItem[]>;
  getSnapshot(boardId: string, snapshotId: string): Promise<SnapshotMeta | null>;
  /** Creates or replaces the snapshot document. */
  setSnapshot(boardId: string, snapshotId: string, meta: SnapshotMeta): Promise<void>;
  deleteSnapshotChunks(boardId: string, snapshotId: string): Promise<void>;
  writeSnapshotChunk(
    boardId: string,
    snapshotId: string,
    index: number,
    entries: readonly SnapshotEntry[],
  ): Promise<void>;
  /** The chunks as stored, in index order. */
  readSnapshotChunks(boardId: string, snapshotId: string): Promise<SnapshotEntry[][]>;
  /**
   * One transaction on the board: `decide` gets the board as it is now and returns the column def to
   * store (it throws to abort). `snapshotPatch` is written to the snapshot in the same transaction.
   */
  updateColumn(
    boardId: string,
    scope: ColumnScope,
    columnId: string,
    decide: (current: ColumnDef | null, board: ChangeBoardData) => ColumnDef,
    snapshotPatch?: { snapshotId: string; patch: Partial<SnapshotMeta> },
  ): Promise<void>;
  /** At most 400 field-path writes (`values.<columnId>`); items that no longer exist are skipped. */
  writeValues(boardId: string, columnId: string, writes: readonly ValueWrite[]): Promise<void>;
  nowMs(): number;
  newId(): string;
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

const hasValue = (value: unknown): boolean => value !== undefined && value !== null;

const inScope = (item: MigrationItem, scope: ColumnScope): boolean =>
  scope === 'columns'
    ? item.parentItemId === null || item.parentItemId === undefined
    : !!item.parentItemId;

const columnsOf = (board: ChangeBoardData, scope: ColumnScope): ColumnDef[] =>
  scope === 'columns' ? board.columns : board.subitemColumns;

/** The column def without the fields only these functions write. */
function stripServerFields(column: ColumnDef): ColumnDef {
  const { migrating: _m, lastTypeChange: _l, ...rest } = column;
  void _m;
  void _l;
  return rest;
}

async function requireAccess(
  store: ColumnTypeChangeStore,
  boardId: string,
  uid: string,
  columnId: string,
  scope: ColumnScope,
): Promise<{ board: ChangeBoardData; column: ColumnDef; role: BoardRole }> {
  const board = await store.getBoard(boardId);
  if (!board) throw new HttpsError('not-found', 'Board not found.');
  const wsRole = await store.getWorkspaceMemberRole(board.workspaceId, uid);
  const role = resolveBoardRole(board, uid, wsRole);
  if (!role || !canEditBoard(role)) {
    throw new HttpsError('permission-denied', 'You do not have permission to edit this board.');
  }
  if (!canEditColumn(role, board, columnId)) {
    throw new HttpsError('permission-denied', COLUMN_LOCKED_MESSAGE);
  }
  const column = columnsOf(board, scope).find((c) => c.id === columnId);
  if (!column) throw new HttpsError('not-found', 'Column not found on this board.');
  return { board, column, role };
}

function isStale(column: ColumnDef, nowMs: number): boolean {
  return !!column.migrating && nowMs - column.migrating.startedAt >= COLUMN_MIGRATION_STALE_MS;
}

/** Groups entries into chunks of at most 400 values and 600k characters. */
export function chunkEntries(entries: readonly SnapshotEntry[]): SnapshotEntry[][] {
  const chunks: SnapshotEntry[][] = [];
  let current: SnapshotEntry[] = [];
  let size = 0;
  for (const entry of entries) {
    const length = JSON.stringify(entry).length;
    if (
      current.length > 0 &&
      (current.length >= COLUMN_MIGRATION_CHUNK_SIZE ||
        size + length > COLUMN_SNAPSHOT_CHUNK_MAX_CHARS)
    ) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function writeInBatches(
  store: ColumnTypeChangeStore,
  boardId: string,
  columnId: string,
  writes: readonly ValueWrite[],
): Promise<void> {
  for (let i = 0; i < writes.length; i += COLUMN_MIGRATION_CHUNK_SIZE) {
    await store.writeValues(boardId, columnId, writes.slice(i, i + COLUMN_MIGRATION_CHUNK_SIZE));
  }
}

/** Reads the snapshot's chunks and checks them against the count recorded on its document. */
async function readVerifiedEntries(
  store: ColumnTypeChangeStore,
  boardId: string,
  snapshotId: string,
  meta: SnapshotMeta,
): Promise<SnapshotEntry[]> {
  const chunks = await store.readSnapshotChunks(boardId, snapshotId);
  const entries = chunks.flat();
  if (chunks.length !== meta.chunkCount || entries.length !== meta.valueCount) {
    throw new HttpsError(
      'data-loss',
      'The backup of this column is incomplete, so nothing was changed.',
    );
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// changeColumnType
// ---------------------------------------------------------------------------------------------

export async function changeColumnTypeLogic(
  store: ColumnTypeChangeStore,
  uid: string,
  req: ChangeColumnTypeRequest,
): Promise<ChangeColumnTypeResult> {
  const { boardId, columnId, scope } = req;
  const { board, column, role } = await requireAccess(store, boardId, uid, columnId, scope);
  const now = store.nowMs();

  // Which snapshot does this call belong to?
  let snapshotId: string;
  let existing: SnapshotMeta | null = null;
  if (column.migrating) {
    const running = column.migrating;
    const sameCall = req.snapshotId === running.snapshotId;
    if (running.kind === 'revert') {
      throw new HttpsError(
        'failed-precondition',
        'An undo of an earlier type change is in progress or was interrupted. Finish it first.',
      );
    }
    if (!sameCall && !isStale(column, now)) {
      throw new HttpsError(
        'failed-precondition',
        'This column is being converted right now. Try again in a few minutes.',
      );
    }
    snapshotId = running.snapshotId;
    existing = await store.getSnapshot(boardId, snapshotId);
    if (!existing) {
      throw new HttpsError(
        'failed-precondition',
        'The interrupted change has no backup to resume from.',
      );
    }
  } else if (req.snapshotId) {
    snapshotId = req.snapshotId;
    existing = await store.getSnapshot(boardId, snapshotId);
    if (
      existing &&
      (existing.columnId !== columnId || existing.scope !== scope || existing.status === 'reverted')
    ) {
      throw new HttpsError('invalid-argument', 'This snapshot id was already used.');
    }
  } else {
    snapshotId = store.newId();
  }

  // The plan comes from the snapshot when there is one, otherwise from the request.
  const fromColumn = existing?.fromColumn ?? column;
  const toType = existing?.toType ?? req.toType;
  const requestedSettings = existing?.toSettings ?? req.toSettings;

  if (!existing) {
    const support = columnTypeChangeSupport(column.type, toType);
    if (!support.allowed) {
      throw new HttpsError(
        'failed-precondition',
        support.reason ?? 'This type change is not allowed.',
      );
    }
    if (support.ownerOnly && role !== 'owner') {
      throw new HttpsError(
        'permission-denied',
        'Only board owners can convert this kind of column.',
      );
    }
  } else if (
    column.type !== fromColumn.type &&
    !(column.type === toType && existing.status === 'applied')
  ) {
    throw new HttpsError(
      'failed-precondition',
      'The column changed since this conversion started.',
    );
  }
  const settingsParsed = columnRegistry.parseSettings(toType, requestedSettings);
  if (!settingsParsed.success) {
    throw new HttpsError('invalid-argument', `Invalid settings: ${settingsParsed.error}`);
  }
  const toSettings = settingsParsed.data as Record<string, unknown>;

  const sourceIsComputed = columnRegistry.isDerived(fromColumn.type);
  const items = (await store.listItems(boardId)).filter((i) => inScope(i, scope));

  // Step 2: the snapshot (never touched again once it is `ready` or later).
  let meta: SnapshotMeta;
  if (existing && existing.status !== 'writing') {
    meta = existing;
  } else {
    const entries: SnapshotEntry[] = sourceIsComputed
      ? []
      : items.flatMap((i) =>
          hasValue(i.values[columnId]) ? [{ itemId: i.id, value: i.values[columnId] }] : [],
        );
    const chunks = chunkEntries(entries);
    meta = {
      columnId,
      scope,
      fromColumn: JSON.parse(JSON.stringify(stripServerFields(fromColumn))) as ColumnDef,
      toType,
      toSettings,
      status: 'writing',
      valueCount: entries.length,
      chunkCount: chunks.length,
      createdBy: existing?.createdBy ?? uid,
      createdAt: existing?.createdAt ?? now,
      expiresAt: existing?.expiresAt ?? now + COLUMN_SNAPSHOT_TTL_MS,
    };
    await store.setSnapshot(boardId, snapshotId, meta);
    await store.deleteSnapshotChunks(boardId, snapshotId);
    for (const [index, chunk] of chunks.entries()) {
      await store.writeSnapshotChunk(boardId, snapshotId, index, chunk);
    }
    // Verify by reading back before anything else is allowed to happen.
    const stored = await readVerifiedEntries(store, boardId, snapshotId, meta);
    if (stored.length !== entries.length) {
      throw new HttpsError(
        'data-loss',
        'The backup of this column is incomplete, so nothing was changed.',
      );
    }
    meta = { ...meta, status: 'ready' };
    await store.setSnapshot(boardId, snapshotId, meta);
  }

  // The values to convert.
  const personNames =
    fromColumn.type === 'people' ? await store.getMemberNames(board.workspaceId) : {};
  let entries: Array<{ id: string; value: unknown }>;
  if (sourceIsComputed) {
    entries = items.flatMap((item) => {
      const value = columnRegistry.computeValue(fromColumn, {
        boardId,
        item: { id: item.id, values: item.values, ...item.meta },
        columns: columnsOf(board, scope),
      });
      return hasValue(value) ? [{ id: item.id, value }] : [];
    });
  } else {
    const stored = await readVerifiedEntries(store, boardId, snapshotId, meta);
    entries = stored.map((e) => ({ id: e.itemId, value: e.value }));
  }
  const defaultKey = '\u0000default';
  const withDefault =
    fromColumn.defaultValue !== undefined
      ? [...entries, { id: defaultKey, value: fromColumn.defaultValue }]
      : entries;
  const plan = planColumnConversion(fromColumn, toType, toSettings, withDefault, { personNames });
  const itemResults = plan.results.filter((r) => r.id !== defaultKey);
  const defaultResult = plan.results.find((r) => r.id === defaultKey);
  const converted = itemResults.filter((r) => r.ok).length;
  const result: ChangeColumnTypeResult = {
    converted,
    cleared: itemResults.length - converted,
    snapshotId,
    toType,
  };

  // A snapshot that was applied and then replaced (or undone) must never be applied again.
  if (existing?.status === 'applied' && column.lastTypeChange?.snapshotId !== snapshotId) {
    throw new HttpsError(
      'failed-precondition',
      'This conversion was already applied and the column has changed since.',
    );
  }
  // Already finished by an earlier run: nothing left to do.
  if (
    !column.migrating &&
    column.lastTypeChange?.snapshotId === snapshotId &&
    column.type === toType
  ) {
    return result;
  }

  // Step 3: mark the column busy.
  await store.updateColumn(boardId, scope, columnId, (current) => {
    if (!current) throw new HttpsError('not-found', 'Column not found on this board.');
    if (
      current.migrating &&
      current.migrating.snapshotId !== snapshotId &&
      !isStale(current, now)
    ) {
      throw new HttpsError('failed-precondition', 'This column is being converted right now.');
    }
    if (current.migrating?.kind === 'revert') {
      throw new HttpsError('failed-precondition', 'An undo is in progress on this column.');
    }
    if (current.type !== fromColumn.type) {
      throw new HttpsError(
        'failed-precondition',
        'The column changed since this conversion started.',
      );
    }
    return { ...current, migrating: { snapshotId, startedAt: now, kind: 'change' } };
  });

  // Step 4: convert.
  await writeInBatches(
    store,
    boardId,
    columnId,
    itemResults.map((r) => ({ itemId: r.id, value: r.ok ? r.value : DELETE_VALUE })),
  );

  // Step 5: finish.
  await store.updateColumn(
    boardId,
    scope,
    columnId,
    (current) => {
      if (!current) throw new HttpsError('not-found', 'Column not found on this board.');
      if (!current.migrating && current.lastTypeChange?.snapshotId === snapshotId) return current;
      if (current.migrating?.snapshotId !== snapshotId || current.migrating.kind !== 'change') {
        throw new HttpsError('aborted', 'The conversion was taken over or undone.');
      }
      const { migrating: _migrating, defaultValue: _default, ...rest } = current;
      void _migrating;
      void _default;
      const next: ColumnDef = {
        ...rest,
        type: toType,
        settings: plan.settings,
        lastTypeChange: { snapshotId, fromType: fromColumn.type, expiresAt: meta.expiresAt },
      };
      if (defaultResult?.ok) next.defaultValue = defaultResult.value;
      return JSON.parse(JSON.stringify(next)) as ColumnDef;
    },
    { snapshotId, patch: { status: 'applied', appliedAt: store.nowMs() } },
  );

  return result;
}

// ---------------------------------------------------------------------------------------------
// revertColumnType
// ---------------------------------------------------------------------------------------------

export async function revertColumnTypeLogic(
  store: ColumnTypeChangeStore,
  uid: string,
  req: RevertColumnTypeRequest,
): Promise<RevertColumnTypeResult> {
  const { boardId, snapshotId } = req;
  const snapshot = await store.getSnapshot(boardId, snapshotId);
  if (!snapshot || snapshot.expiresAt <= store.nowMs()) {
    throw new HttpsError('not-found', 'This type change can no longer be undone.');
  }
  const { columnId, scope } = snapshot;
  const { column } = await requireAccess(store, boardId, uid, columnId, scope);
  const now = store.nowMs();
  const from = snapshot.fromColumn;

  const restoredAlready =
    snapshot.status === 'reverted' &&
    !column.migrating &&
    column.type === from.type &&
    !column.lastTypeChange;
  if (restoredAlready) {
    return { restored: snapshot.valueCount, removed: 0, snapshotId, columnId };
  }

  if (column.migrating) {
    const running = column.migrating;
    if (running.snapshotId !== snapshotId) {
      throw new HttpsError(
        'failed-precondition',
        'This column is being converted by another change.',
      );
    }
    // A fresh change run is still working; a revert retry or a stale run may be taken over.
    if (running.kind === 'change' && !isStale(column, now)) {
      throw new HttpsError(
        'failed-precondition',
        'This column is being converted right now. Try again in a few minutes.',
      );
    }
  } else if (column.lastTypeChange?.snapshotId !== snapshotId || snapshot.status !== 'applied') {
    throw new HttpsError(
      'failed-precondition',
      'The column was changed again after this conversion, so it cannot be undone from here.',
    );
  }
  if (snapshot.status === 'writing') {
    throw new HttpsError(
      'failed-precondition',
      'The backup was never completed; nothing was changed.',
    );
  }

  const entries = await readVerifiedEntries(store, boardId, snapshotId, snapshot);
  const backup = new Map(entries.map((e) => [e.itemId, e.value]));
  const items = (await store.listItems(boardId)).filter((i) => inScope(i, scope));

  await store.updateColumn(boardId, scope, columnId, (current) => {
    if (!current) throw new HttpsError('not-found', 'Column not found on this board.');
    if (current.migrating && current.migrating.snapshotId !== snapshotId) {
      throw new HttpsError(
        'failed-precondition',
        'This column is being converted by another change.',
      );
    }
    return { ...current, migrating: { snapshotId, startedAt: now, kind: 'revert' } };
  });

  const writes: ValueWrite[] = [];
  let restored = 0;
  let removed = 0;
  for (const item of items) {
    if (backup.has(item.id)) {
      writes.push({ itemId: item.id, value: backup.get(item.id) });
      restored += 1;
    } else if (hasValue(item.values[columnId])) {
      writes.push({ itemId: item.id, value: DELETE_VALUE });
      removed += 1;
    }
  }
  // Items the backup knows but that are no longer listed (purged) are skipped by the store.
  await writeInBatches(store, boardId, columnId, writes);

  await store.updateColumn(
    boardId,
    scope,
    columnId,
    (current) => {
      if (!current) throw new HttpsError('not-found', 'Column not found on this board.');
      if (!current.migrating && !current.lastTypeChange && current.type === from.type)
        return current;
      if (current.migrating?.snapshotId !== snapshotId) {
        throw new HttpsError('aborted', 'The undo was taken over by another run.');
      }
      const {
        migrating: _migrating,
        lastTypeChange: _lastTypeChange,
        defaultValue: _default,
        ...rest
      } = current;
      void _migrating;
      void _lastTypeChange;
      void _default;
      const next: ColumnDef = { ...rest, type: from.type, settings: from.settings };
      if (from.defaultValue !== undefined) next.defaultValue = from.defaultValue;
      return JSON.parse(JSON.stringify(next)) as ColumnDef;
    },
    { snapshotId, patch: { status: 'reverted', revertedAt: store.nowMs() } },
  );

  return { restored, removed, snapshotId, columnId };
}
