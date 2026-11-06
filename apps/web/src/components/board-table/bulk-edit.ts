/**
 * Bulk edit (docs/specs/P1-bulk-edit-selected.md): after a cell edit in a selected row, the same
 * value can be applied to the other selected rows of the same level. This module is the pure part:
 * which column types qualify, which selected rows are peers, and the plan (writes and skips). The
 * writes themselves run in `tableActions.applyToSelected`.
 */
import { COLUMN_LOCKED_MESSAGE, columnRegistry, isSubitem, type ColumnDef } from '@atrium/shared';
import type { ItemDoc } from '../../data';
import { validateCellWrite, type ColumnLockContext } from './derived';
import { checkRequiredWrite } from './required-write';
import type { TableCtx } from './table-actions';

/**
 * Types that are never bulk-applied on top of derived and server-managed ones (which the registry
 * reports): a vote belongs to the person who cast it, and the others hold per-row identity or links.
 */
const NOT_BULK_TYPES: ReadonlySet<string> = new Set([
  'vote',
  'files',
  'button',
  'time_tracking',
  'auto_number',
  'item_id',
  'formula',
  'mirror',
  'dependency',
  'board_relation',
]);

/** True when a value of this column type can be applied to several rows at once. */
export function isBulkEditableType(type: string): boolean {
  return (
    !NOT_BULK_TYPES.has(type) &&
    !columnRegistry.isDerived(type) &&
    !columnRegistry.isServerManaged(type)
  );
}

/** The selected rows other than `edited`, at the same level (top-level or subitem) as it. */
export function bulkPeers(
  items: readonly ItemDoc[],
  selected: ReadonlySet<string>,
  edited: Pick<ItemDoc, 'id' | 'parentItemId'>,
): ItemDoc[] {
  const level = isSubitem(edited);
  return items.filter((i) => i.id !== edited.id && selected.has(i.id) && isSubitem(i) === level);
}

export type BulkSkipReason = 'locked' | 'required' | 'invalid';

export interface BulkPlan {
  /** Rows to write (the edited row is not among them: it was written first). */
  writes: { itemId: string; value: unknown; previous: unknown }[];
  skipped: { itemId: string; reason: BulkSkipReason }[];
  /** Rows the change was offered to, the edited one included. */
  total: number;
}

export interface BulkPlanInput {
  boardId: string;
  columns: readonly ColumnDef[];
  columnId: string;
  value: unknown;
  peers: readonly ItemDoc[];
  lockCtx?: ColumnLockContext;
}

/** Decides, per peer row, whether `value` can be written to `columnId`. Never drops a row silently. */
export function planBulkApply(input: BulkPlanInput): BulkPlan {
  const { boardId, columns, columnId, value, peers, lockCtx } = input;
  const writes: BulkPlan['writes'] = [];
  const skipped: BulkPlan['skipped'] = [];
  const column = columns.find((c) => c.id === columnId);
  for (const peer of peers) {
    if (!column || !isBulkEditableType(column.type)) {
      skipped.push({ itemId: peer.id, reason: 'invalid' });
      continue;
    }
    const check = validateCellWrite(boardId, columns, columnId, value, peer, lockCtx);
    if (!check.ok) {
      skipped.push({
        itemId: peer.id,
        reason: check.message === COLUMN_LOCKED_MESSAGE ? 'locked' : 'invalid',
      });
      continue;
    }
    if (checkRequiredWrite(columns, columnId, value, peer)) {
      skipped.push({ itemId: peer.id, reason: 'required' });
      continue;
    }
    writes.push({ itemId: peer.id, value, previous: peer.values?.[columnId] ?? null });
  }
  return { writes, skipped, total: peers.length + 1 };
}

/** What the popup under the edited cell needs to apply the change. */
export interface BulkOffer {
  ctx: TableCtx;
  itemId: string;
  columnId: string;
  value: unknown;
  /** The edited row's value before the edit, for the batch Undo. */
  previous: unknown;
  /** Rows the popup counts, the edited one included. */
  count: number;
}

/** Toast text after applying: never hides skipped rows. */
export function bulkSummary(updated: number, total: number, skipped: number): string {
  if (skipped === 0) return `Updated ${updated} items.`;
  return `Updated ${updated} of ${total} items; ${skipped} skipped (locked or required).`;
}
