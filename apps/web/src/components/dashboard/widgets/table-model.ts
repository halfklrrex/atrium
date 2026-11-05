/**
 * Table widget model (P6): a filtered list of items across the widget's boards, one row per item
 * with its board and a few columns. Pure: no React and no Firebase.
 *
 * Rows come from My Work's `buildRows` (so the date, status and people columns are picked the
 * same way). The chosen columns are matched on each board by id, then by type and title
 * (`widget-columns.ts`); a board without a column shows an empty cell. With no columns chosen the
 * table shows Status, People and Date. The status filter matches by label text, as in Numbers.
 * Subitems are not listed. Rows sort like My Work (date, board, position) and are capped at
 * `rowLimit`; `total` is the count before the cap.
 */
import { columnRegistry, type DashboardWidget } from '@atrium/shared';
import { columnContextFor } from '../../board-table/derived';
import type { ColumnView } from '../../board-table/table-model';
import { buildRows, compareRows, type MyWorkRow } from '../../../pages/my-work/my-work-model';
import { filterTexts } from './numbers-model';
import {
  columnOptions,
  readStatusLabel,
  resolveColumn,
  widgetBoards,
  type WidgetBoardData,
} from './widget-columns';

export type TableSettings = Extract<DashboardWidget, { type: 'table' }>['settings'];

export interface TableCell {
  column: ColumnView;
  /** The parsed (or computed) value; `null` when empty. */
  value: unknown;
}

export interface TableRow {
  key: string;
  row: MyWorkRow;
  /** One entry per header after Item and Board; `null` when the board has no such column. */
  cells: (TableCell | null)[];
}

export interface TableModel {
  /** Column headers after Item and Board. */
  headers: string[];
  rows: TableRow[];
  /** Items that passed the filter. */
  total: number;
  /** "Showing 10 of 24" when the cap hides rows, else `null`. */
  note: string | null;
  summary: string;
}

const lower = (text: string): string => text.trim().toLowerCase();

function cellOf(
  row: MyWorkRow,
  view: ColumnView | undefined,
  boardColumns: WidgetBoardData['board'],
): TableCell | null {
  if (!view) return null;
  if (columnRegistry.isDerived(view.def.type)) {
    const value = columnRegistry.computeValue(
      view.def,
      columnContextFor(boardColumns.id, boardColumns.columns, row.item),
    );
    return { column: view, value: value ?? null };
  }
  const raw = row.item.values[view.def.id];
  const parsed =
    raw === null || raw === undefined ? null : columnRegistry.parseValue(view.def.type, raw);
  return { column: view, value: parsed?.success ? parsed.data : null };
}

export function buildTableModel(input: {
  boards: readonly WidgetBoardData[];
  widgetBoardIds: readonly string[];
  settings: TableSettings;
}): TableModel {
  const boards = widgetBoards(input.boards, input.widgetBoardIds);
  const { settings } = input;
  const allBoards = boards.map((b) => b.board);

  const filter = settings.filter && settings.filter.values.length > 0 ? settings.filter : null;
  const texts = filter ? filterTexts(boards, filter) : null;

  const entries = boards.flatMap(({ board, items }) => {
    const filterDef = filter ? resolveColumn(allBoards, board, filter.columnId) : null;
    if (filter && !filterDef) return [];
    return items
      .filter((item) => {
        if (item.parentItemId != null) return false;
        if (!filterDef || !texts) return true;
        const label = readStatusLabel(item, filterDef);
        return label !== null && texts.has(lower(label.label));
      })
      .map((item) => ({ board, item }));
  });
  const all = buildRows(entries, new Map()).sort(compareRows);
  const rows = all.slice(0, settings.rowLimit);

  const chosen = settings.columnIds;
  let headers: string[];
  if (chosen.length === 0) {
    headers = ['Status', 'People', 'Date'];
  } else {
    const options = columnOptions(allBoards, () => true);
    headers = chosen.map((id) => options.find((o) => o.id === id)?.title ?? 'Column');
  }

  const tableRows: TableRow[] = rows.map((row) => {
    const cells =
      chosen.length === 0
        ? [row.statusColumn, row.peopleColumn, row.dateColumn].map((v) => cellOf(row, v, row.board))
        : chosen.map((id) => {
            const def = resolveColumn(allBoards, row.board, id);
            const view = def ? row.columns.find((c) => c.def.id === def.id) : undefined;
            return cellOf(row, view, row.board);
          });
    return { key: row.key, row, cells };
  });

  const total = all.length;
  const note = total > tableRows.length ? `Showing ${tableRows.length} of ${total}` : null;
  return {
    headers,
    rows: tableRows,
    total,
    note,
    summary: `Table of ${total} ${total === 1 ? 'item' : 'items'}${note ? `, ${note.toLowerCase()}` : ''}`,
  };
}
