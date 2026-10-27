/**
 * Client half of the derived and server-managed column framework (architecture section 6.2): the
 * context handed to a type's `compute`/`validateValue`, the read-only value of a derived cell, and
 * the helpers every value write goes through. Rules enforce the same thing on the server, so these
 * only exist to give a good message and to never send a write that would be refused.
 */
import {
  columnRegistry,
  type ColumnContext,
  type ColumnDef,
  type ValidationResult,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';

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

/**
 * Validates a cell write before it is sent: schema, settings-dependent rules and the derived and
 * server-managed column bans. A column that no longer exists on the board is refused too.
 */
export function validateCellWrite(
  boardId: string,
  columns: readonly ColumnDef[],
  columnId: string,
  value: unknown,
  item?: ItemDoc,
): ValidationResult {
  const def = columns.find((c) => c.id === columnId);
  if (!def) return { ok: false, message: 'This column no longer exists' };
  return columnRegistry.validateCell(
    def,
    value,
    item ? columnContextFor(boardId, columns, item) : undefined,
  );
}

/**
 * `values` without the ids of derived and server-managed columns: new items must never carry them
 * (rules refuse such a create), so a duplicated item starts with those cells empty.
 */
export function withoutUnwritableValues(
  values: Record<string, unknown>,
  columns: readonly ColumnDef[],
): Record<string, unknown> {
  const unwritable = new Set([
    ...columnRegistry.derivedColumnIds(columns),
    ...columnRegistry.serverManagedColumnIds(columns),
  ]);
  if (unwritable.size === 0) return values;
  return Object.fromEntries(Object.entries(values).filter(([id]) => !unwritable.has(id)));
}
