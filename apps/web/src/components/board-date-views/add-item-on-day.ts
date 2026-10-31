import type { ColumnDef, GroupDef } from '@atrium/shared';
import type { ItemDoc } from '../../data';
import { positionAfterAll } from '../../lib/positions';
import { validateCellWrite, type ColumnLockContext } from '../board-table/derived';
import { openItemFull } from '../board-table/open-item';
import { tableActions, type TableCtx } from '../board-table/table-actions';
import type { ColumnView } from '../board-table/table-model';
import { showToast } from '../toast-store';
import { valueForDay } from './date-view-model';

export interface AddItemOnDayInput {
  ctx: TableCtx;
  boardId: string;
  column: ColumnView | null;
  canWrite: boolean;
  columnDefs: ColumnDef[];
  /** The board's locks and the user's role (what `validateCellWrite` checks). */
  lockCtx: ColumnLockContext;
  groupDefs: readonly GroupDef[];
  items: readonly ItemDoc[];
  day: string;
}

/**
 * Add an item to the board's first group with the date or timeline column set to `day` (a date, or
 * a one-day timeline), then open its full item view. The value is validated like any cell write.
 */
export async function addItemOnDay(input: AddItemOnDayInput): Promise<void> {
  const { ctx, boardId, column, canWrite, columnDefs, lockCtx, groupDefs } = input;
  if (!column || !canWrite) return;
  const value = valueForDay(column, input.day);
  const check = validateCellWrite(boardId, columnDefs, column.def.id, value, undefined, lockCtx);
  if (!check.ok) {
    showToast(check.message, { type: 'negative' });
    return;
  }
  let groupId = [...groupDefs].sort((a, b) => (a.position < b.position ? -1 : 1))[0]?.id;
  if (!groupId) groupId = (await tableActions.addGroup(ctx, 'top', 'Group Title')) ?? undefined;
  if (!groupId) return;
  const id = await tableActions.addItem(ctx, {
    groupId,
    position: positionAfterAll(
      input.items.filter((i) => i.groupId === groupId && !i.parentItemId),
    ),
    values: { [column.def.id]: value },
  });
  if (id) openItemFull(boardId, id);
}
