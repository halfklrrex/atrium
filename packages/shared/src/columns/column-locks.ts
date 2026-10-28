import type { BoardRole } from '../roles';

export interface BoardWithColumnLocks {
  columnLocks?: readonly string[] | null;
}

export const COLUMN_LOCKED_MESSAGE = 'This column is locked. Only board owners can edit it.';
export const COLUMN_LOCKED_TOOLTIP = 'Only board owners can edit this column';

/**
 * Returns true when `columnId` is listed in `board.columnLocks`.
 * Missing `board` or missing `columnLocks` behaves as unlocked (`false`).
 */
export function isColumnLocked(
  board: BoardWithColumnLocks | null | undefined,
  columnId: string,
): boolean {
  return Boolean(board?.columnLocks && board.columnLocks.includes(columnId));
}

/**
 * Returns true when the column is not locked, or when `boardRole` is `'owner'`.
 * (Board-level edit permission `canEditBoard(boardRole)` is checked separately.)
 */
export function canEditColumn(
  boardRole: BoardRole | null | undefined,
  board: BoardWithColumnLocks | null | undefined,
  columnId: string,
): boolean {
  if (boardRole === 'owner') return true;
  return !isColumnLocked(board, columnId);
}
