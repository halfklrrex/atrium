/**
 * Client half of the derived and server-managed column framework (architecture section 6.2): the
 * context handed to a type's `compute`/`validateValue`, the read-only value of a derived cell, and
 * the helpers every value write goes through. Rules enforce the same thing on the server, so these
 * only exist to give a good message and to never send a write that would be refused.
 */
import {
  COLUMN_LOCKED_MESSAGE,
  COLUMN_LOCKED_TOOLTIP,
  applyDefaultColumnValues,
  canEditColumn,
  columnRegistry,
  isColumnLocked,
  type BoardRole,
  type BoardWithColumnLocks,
  type ColumnContext,
  type ColumnDef,
  type ValidationResult,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';

export {
  COLUMN_LOCKED_MESSAGE,
  COLUMN_LOCKED_TOOLTIP,
  canEditColumn,
  isColumnLocked,
  type BoardRole,
  type BoardWithColumnLocks,
};

export interface ColumnLockContext {
  board?: BoardWithColumnLocks | null;
  boardRole?: BoardRole | null;
}

/** The `ColumnContext` of one item on a board. Plain data the table already holds. */
export function columnContextFor(
  boardId: string,
  columns: readonly ColumnDef[],
  item: ItemDoc,
): ColumnContext {
  return {
    boardId,
    item: {
      id: item.id,
      values: item.values,
      createdAt: item.createdAt,
      createdBy: item.createdBy,
      updatedAt: item.updatedAt,
      updatedBy: item.updatedBy,
      groupId: item.groupId,
      seq: item.seq,
      boardSeq: item.boardSeq,
    },
    columns,
  };
}

/** Value a derived cell shows (computed, never stored). `null` when there is nothing to show. */
export function derivedCellValue(
  boardId: string,
  columns: readonly ColumnDef[],
  def: ColumnDef,
  item: ItemDoc,
): unknown {
  return columnRegistry.computeValue(def, columnContextFor(boardId, columns, item));
}

/** Tooltip of a server-managed cell: only Atrium's Cloud Functions write it (FW2). */
export const SERVER_MANAGED_TOOLTIP = 'Managed by Atrium';

/**
 * True when clients can never write the type's cells: derived (computed, nothing stored) and
 * server-managed (written only by Cloud Functions). Such cells never open an editor.
 */
export function isClientReadOnlyType(type: string): boolean {
  return columnRegistry.isDerived(type) || columnRegistry.isServerManaged(type);
}

/** Message and tooltip of a column whose type is being changed (`ColumnDef.migrating`). */
export const COLUMN_MIGRATING_MESSAGE = 'This column is being converted. Try again in a moment.';
export const COLUMN_MIGRATING_TOOLTIP = 'Converting this column…';

/**
 * True when a column is read-only for this user: either the type itself is client read-only
 * (derived / server-managed), the column is locked and the caller is not a board owner, or its type
 * is being changed right now (`migrating`).
 */
export function isColumnReadOnlyForUser(
  type: string,
  board: BoardWithColumnLocks | null | undefined,
  columnId: string,
  boardRole?: BoardRole | null | undefined,
  migrating?: boolean,
): boolean {
  return isClientReadOnlyType(type) || !canEditColumn(boardRole, board, columnId) || !!migrating;
}

/**
 * Validates a cell write before it is sent: schema, settings-dependent rules, column locks and the
 * derived and server-managed column bans. A column that no longer exists on the board is refused too.
 */
export function validateCellWrite(
  boardId: string,
  columns: readonly ColumnDef[],
  columnId: string,
  value: unknown,
  item?: ItemDoc,
  lockCtx?: ColumnLockContext,
): ValidationResult {
  const def = columns.find((c) => c.id === columnId);
  if (!def) return { ok: false, message: 'This column no longer exists' };
  if (def.migrating) return { ok: false, message: COLUMN_MIGRATING_MESSAGE };
  if (lockCtx && !canEditColumn(lockCtx.boardRole, lockCtx.board, columnId)) {
    return { ok: false, message: COLUMN_LOCKED_MESSAGE };
  }
  return columnRegistry.validateCell(
    def,
    value,
    item ? columnContextFor(boardId, columns, item) : undefined,
  );
}

/**
 * `values` without the ids of derived and server-managed columns (and locked columns when the
 * caller is not a board owner): new items must never carry them (rules refuse such a create), so a
 * duplicated item starts with those cells empty.
 */
export function withoutUnwritableValues(
  values: Record<string, unknown>,
  columns: readonly ColumnDef[],
  options?: ColumnLockContext,
): Record<string, unknown> {
  const unwritable = new Set([
    ...columnRegistry.derivedColumnIds(columns),
    ...columnRegistry.serverManagedColumnIds(columns),
  ]);
  if (options && options.boardRole !== 'owner') {
    for (const id of Object.keys(values)) {
      if (isColumnLocked(options.board, id)) {
        unwritable.add(id);
      }
    }
  }
  if (unwritable.size === 0) return values;
  return Object.fromEntries(Object.entries(values).filter(([id]) => !unwritable.has(id)));
}

/**
 * The cell values a new item starts with: the columns' defaults (derived and server-managed
 * columns skipped, locked columns skipped for non-owners), then `explicit` on top, which wins.
 * `undefined` when there is nothing to write.
 */
export function newItemValues(
  columns: readonly ColumnDef[],
  options?: ColumnLockContext,
  explicit?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const writable = columns.filter(
    (c) => !options || canEditColumn(options.boardRole, options.board, c.id),
  );
  const defaults = withoutUnwritableValues(applyDefaultColumnValues(writable), writable, options);
  const merged = { ...JSON.parse(JSON.stringify(defaults)), ...explicit };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
