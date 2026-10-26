import type { CellRef } from './table-store';

export type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

export function isArrowKey(key: string): key is ArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

/**
 * Where an arrow key moves the active cell. `rowIds` are the visible items top to bottom (across
 * expanded groups) and `columnIds` the cells of a row left to right, the name cell first. Moves
 * stop at the edges. With no active cell the first arrow lands on the first cell.
 */
export function moveActiveCell(
  active: CellRef | null,
  key: ArrowKey,
  rowIds: readonly string[],
  columnIds: readonly string[],
): CellRef | null {
  if (rowIds.length === 0 || columnIds.length === 0) return null;
  if (!active) return { itemId: rowIds[0]!, columnId: columnIds[0]! };
  let row = rowIds.indexOf(active.itemId);
  let col = columnIds.indexOf(active.columnId);
  if (row === -1) row = 0;
  if (col === -1) col = 0;
  if (key === 'ArrowUp') row = Math.max(0, row - 1);
  else if (key === 'ArrowDown') row = Math.min(rowIds.length - 1, row + 1);
  else if (key === 'ArrowLeft') col = Math.max(0, col - 1);
  else col = Math.min(columnIds.length - 1, col + 1);
  return { itemId: rowIds[row]!, columnId: columnIds[col]! };
}

/** Keys typed into a field belong to the field, not to the table's keyboard handling. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
