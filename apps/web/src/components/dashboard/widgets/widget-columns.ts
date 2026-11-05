/**
 * Column helpers shared by the dashboard widgets (P6). Pure: no React, no Firebase.
 *
 * A widget stores one column id, but a dashboard reads several boards and every board has its own
 * column ids. `resolveColumn` therefore matches a board's column by id first, then (on the other
 * boards) by the same type and title (case-insensitive) as the column the id was picked from.
 * Values are read through the column registry: stored cells come from `item.values`, derived ones
 * (formula, progress) are computed with the item's board columns, as on the board itself.
 */
import {
  columnRegistry,
  findStatusLabel,
  type ColumnDef,
  type FormulaSettings,
  type StatusSettings,
  type StatusValue,
} from '@atrium/shared';
import type { BoardDoc, ItemDoc } from '../../../data';
import { columnContextFor } from '../../board-table/derived';

export interface WidgetBoardData {
  board: BoardDoc;
  items: readonly ItemDoc[];
}

/** Column types whose value can be a number in Numbers widgets (formulas only with a number output). */
export function isNumericColumn(def: ColumnDef): boolean {
  if (def.type === 'numbers' || def.type === 'progress') return true;
  if (def.type === 'formula') {
    return (def.settings as Partial<FormulaSettings>).outputType === 'number';
  }
  return false;
}

export const isStatusColumn = (def: ColumnDef): boolean => def.type === 'status';

export interface ColumnOption {
  /** The id stored in the widget settings (taken from the first board that has the column). */
  id: string;
  title: string;
  type: string;
  /** Boards that have a matching column. */
  boardCount: number;
}

const sameColumn = (a: ColumnDef, b: ColumnDef): boolean =>
  a.type === b.type && a.title.trim().toLowerCase() === b.title.trim().toLowerCase();

/** Columns the picker offers: those passing `accept`, merged across boards by type and title. */
export function columnOptions(
  boards: readonly Pick<BoardDoc, 'columns'>[],
  accept: (def: ColumnDef) => boolean,
): ColumnOption[] {
  const options: { def: ColumnDef; boardCount: number }[] = [];
  for (const board of boards) {
    for (const def of board.columns) {
      if (!accept(def)) continue;
      const existing = options.find((o) => sameColumn(o.def, def));
      if (existing) existing.boardCount += 1;
      else options.push({ def, boardCount: 1 });
    }
  }
  return options.map(({ def, boardCount }) => ({
    id: def.id,
    title: def.title,
    type: def.type,
    boardCount,
  }));
}

/** The column `columnId` points at on `board` (see the header comment), or `null`. */
export function resolveColumn(
  boards: readonly Pick<BoardDoc, 'columns'>[],
  board: Pick<BoardDoc, 'columns'>,
  columnId: string | null,
): ColumnDef | null {
  if (!columnId) return null;
  const direct = board.columns.find((c) => c.id === columnId);
  if (direct) return direct;
  let reference: ColumnDef | undefined;
  for (const other of boards) {
    reference = other.columns.find((c) => c.id === columnId);
    if (reference) break;
  }
  if (!reference) return null;
  const ref = reference;
  return board.columns.find((c) => sameColumn(c, ref)) ?? null;
}

/** A finite number from a stored or computed cell value, else `null`. */
export function numberOf(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'object' && raw !== null && 'progress' in raw) {
    return numberOf((raw as { progress: unknown }).progress);
  }
  return null;
}

/** The number in an item's cell for `def`, computing derived columns; `null` when empty. */
export function readNumber(board: BoardDoc, item: ItemDoc, def: ColumnDef): number | null {
  if (columnRegistry.isDerived(def.type)) {
    return numberOf(
      columnRegistry.computeValue(def, columnContextFor(board.id, board.columns, item)),
    );
  }
  return numberOf(item.values[def.id]);
}

/** The status label of an item's cell for a status column, or `null` when empty or unknown. */
export function readStatusLabel(item: ItemDoc, def: ColumnDef) {
  const raw = item.values[def.id];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const settings = def.settings as unknown as StatusSettings;
  if (!Array.isArray(settings?.labels)) return null;
  const label = findStatusLabel(raw as StatusValue, settings);
  return label && label.label.trim() !== '' ? label : null;
}

/** The boards a widget reads: its own list when set, else all of the dashboard's, in order. */
export function widgetBoards<T extends { board: Pick<BoardDoc, 'id'> }>(
  all: readonly T[],
  widgetBoardIds: readonly string[],
): T[] {
  if (widgetBoardIds.length === 0) return [...all];
  const wanted = new Set(widgetBoardIds);
  return all.filter((b) => wanted.has(b.board.id));
}
