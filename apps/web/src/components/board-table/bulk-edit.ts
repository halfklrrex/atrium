/**
 * Bulk edit (docs/specs/P1-bulk-edit-selected.md): a cell edit in a selected row applies at once to
 * all selected rows of the same level. This module is the pure part: which column types qualify,
 * which selected rows are peers, and the plan (writes and skips). The writes themselves run in
 * `tableActions.applyBulkEdit`.
 */
import { COLUMN_LOCKED_MESSAGE, columnRegistry, isSubitem, type ColumnDef } from '@atrium/shared';
import type { ItemDoc } from '../../data';
import { validateCellWrite, type ColumnLockContext } from './derived';
import { checkRequiredWrite } from './required-write';

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
  /** Rows to write (the edited row is not among them: the caller writes it in the same batch). */
  writes: { itemId: string; value: unknown; previous: unknown }[];
  skipped: { itemId: string; reason: BulkSkipReason }[];
  /** Rows the change applies to, the edited one included. */
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

/** Toast text after applying: never hides skipped rows. */
export function bulkSummary(updated: number, total: number, skipped: number): string {
  if (skipped === 0) return `Updated ${updated} items`;
  return `Updated ${updated} of ${total} items; ${skipped} skipped (locked or required)`;
}

export type BulkUndoKeepReason = 'locked' | 'required' | 'changed' | 'gone';

export interface BulkUndoPlan {
  /** Rows whose previous value can be put back. */
  restore: { id: string; value: unknown }[];
  /** Rows that keep their current state, with why (never dropped silently). */
  kept: { id: string; reason: BulkUndoKeepReason }[];
}

export interface BulkUndoInput {
  columns: readonly ColumnDef[];
  columnId: string;
  /** Previous value per row id, as captured before the bulk write. */
  previousById: ReadonlyMap<string, unknown>;
  /** The value the bulk edit wrote: a row that no longer holds it was edited since. */
  written: unknown;
  /** The rows to undo, in order, as they are NOW (after the bulk write). */
  current: readonly Pick<ItemDoc, 'id' | 'values'>[];
  /** Ids of rows that no longer exist (deleted or archived since the edit). */
  gone?: readonly string[];
  /** True when the column has become locked for this person since the edit. */
  locked?: boolean;
}

/** Structural equality for cell values (plain JSON-like data). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * Decides which rows an Undo can restore. A row is restored only if it still holds the value the
 * bulk edit wrote (otherwise someone edited it since and Undo must not clobber that), still
 * exists, and the column is not locked. The forward write may fill an empty required cell; the
 * Undo would empty it again, which the required-columns rule (`requiredCellsOk`) refuses for the
 * whole atomic batch, so each row is also checked against its CURRENT state with the same check
 * the forward path uses. Rows that cannot be restored are reported, never dropped silently.
 */
export function planBulkUndo(input: BulkUndoInput): BulkUndoPlan {
  const { columns, columnId, previousById, written, current, gone = [], locked = false } = input;
  const restore: BulkUndoPlan['restore'] = [];
  const kept: BulkUndoPlan['kept'] = [];
  for (const id of gone) kept.push({ id, reason: 'gone' });
  for (const item of current) {
    const value = previousById.get(item.id) ?? null;
    if (locked) {
      kept.push({ id: item.id, reason: 'locked' });
    } else if (!sameValue(item.values?.[columnId], written)) {
      kept.push({ id: item.id, reason: 'changed' });
    } else if (checkRequiredWrite(columns, columnId, value, item)) {
      kept.push({ id: item.id, reason: 'required' });
    } else {
      restore.push({ id: item.id, value });
    }
  }
  return { restore, kept };
}

const itemsWord = (n: number) => (n === 1 ? '1 item' : `${n} items`);

/** Toast text after an Undo: never hides the rows that kept their state. */
export function bulkUndoSummary(
  restored: number,
  total: number,
  kept: readonly { reason: BulkUndoKeepReason }[],
  columnTitle: string,
): string {
  if (kept.length === 0) return `Undid ${itemsWord(restored)}`;
  const count = (r: BulkUndoKeepReason) => kept.filter((k) => k.reason === r).length;
  const parts: string[] = [];
  const changed = count('changed');
  const gone = count('gone');
  const blocked = kept.length - changed - gone;
  if (blocked > 0) {
    const required = kept.some((k) => k.reason === 'required');
    const locked = kept.some((k) => k.reason === 'locked');
    const why =
      required && locked
        ? `${columnTitle} is required or locked`
        : locked
          ? `${columnTitle} is locked`
          : `${columnTitle} is required`;
    parts.push(`${itemsWord(blocked)} kept the new value because ${why}`);
  }
  if (changed > 0) parts.push(`${itemsWord(changed)} kept their newer value`);
  if (gone > 0) parts.push(`${itemsWord(gone)} no longer exist${gone === 1 ? 's' : ''}`);
  return `Undid ${restored} of ${total} items; ${parts.join('; ')}`;
}
