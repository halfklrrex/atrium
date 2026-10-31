import { columnRegistry, type GroupDef } from '@atrium/shared';
import { isRowDone } from '../../components/board-table/table-env';
import { buildColumnViews, type ColumnView } from '../../components/board-table/table-model';
import type { BoardDoc, ItemDoc } from '../../data';
import { addDays, weekStart, type FirstDayOfWeek } from '../../lib/date-grid';
import { comparePositions } from '../../lib/positions';

export type MyWorkBucket = 'past' | 'today' | 'thisWeek' | 'nextWeek' | 'later' | 'none' | 'done';

/** Sections in display order, with monday's titles. */
export const MY_WORK_BUCKETS: readonly { id: MyWorkBucket; title: string }[] = [
  { id: 'past', title: 'Past dates' },
  { id: 'today', title: 'Today' },
  { id: 'thisWeek', title: 'This week' },
  { id: 'nextWeek', title: 'Next week' },
  { id: 'later', title: 'Later' },
  { id: 'none', title: 'Without a date' },
  { id: 'done', title: 'Done' },
];

/** What the data layer hands over: an item and the board it lives on. */
export interface AssignedEntry {
  board: BoardDoc;
  item: ItemDoc;
}

/** One table row of My Work: an assigned item with everything its cells need. */
export interface MyWorkRow {
  key: string;
  board: BoardDoc;
  workspaceName: string;
  item: ItemDoc;
  group: GroupDef | undefined;
  /** The columns that apply to this item (a subitem uses the board's subitem columns). */
  columns: ColumnView[];
  peopleColumn: ColumnView | undefined;
  statusColumn: ColumnView | undefined;
  /** The column the date comes from (first date column with a value, else first timeline). */
  dateColumn: ColumnView | undefined;
  /** `YYYY-MM-DD`, or null when the item has no date. */
  date: string | null;
  done: boolean;
}

function dateOf(
  item: ItemDoc,
  columns: readonly ColumnView[],
): { column?: ColumnView; date: string | null } {
  for (const column of columns) {
    if (column.def.type !== 'date') continue;
    const parsed = columnRegistry.parseValue('date', item.values[column.def.id]);
    if (parsed.success && parsed.data)
      return { column, date: (parsed.data as { date: string }).date };
  }
  for (const column of columns) {
    if (column.def.type !== 'timeline') continue;
    const parsed = columnRegistry.parseValue('timeline', item.values[column.def.id]);
    if (parsed.success && parsed.data) return { column, date: (parsed.data as { to: string }).to };
  }
  return { date: null };
}

/** Turns entries into rows. Column views are built once per board and kind (main or subitem). */
export function buildRows(
  entries: readonly AssignedEntry[],
  workspaceNames: ReadonlyMap<string, string>,
): MyWorkRow[] {
  const cache = new Map<string, ColumnView[]>();
  const viewsOf = (board: BoardDoc, subitem: boolean): ColumnView[] => {
    const key = `${board.id}:${subitem ? 's' : 'm'}`;
    let views = cache.get(key);
    if (!views) {
      views = buildColumnViews(subitem ? board.subitemColumns : board.columns);
      cache.set(key, views);
    }
    return views;
  };
  return entries.map(({ board, item }) => {
    const columns = viewsOf(board, item.parentItemId != null);
    const { column, date } = dateOf(item, columns);
    return {
      key: `${board.id}/${item.id}`,
      board,
      workspaceName: workspaceNames.get(board.workspaceId) ?? '',
      item,
      group: board.groups.find((g) => g.id === item.groupId),
      columns,
      peopleColumn: columns.find((c) => c.def.type === 'people'),
      statusColumn: columns.find((c) => c.def.type === 'status'),
      dateColumn: column,
      date,
      done: isRowDone(item, columns),
    };
  });
}

/**
 * Which section a row belongs to. Done wins over any date; otherwise the date decides: before
 * today, today, the rest of this week, next week, later, or none.
 */
export function bucketOf(
  row: Pick<MyWorkRow, 'date' | 'done'>,
  today: string,
  firstDayOfWeek: FirstDayOfWeek = 'monday',
): MyWorkBucket {
  if (row.done) return 'done';
  const { date } = row;
  if (!date) return 'none';
  if (date < today) return 'past';
  if (date === today) return 'today';
  const thisWeekEnd = addDays(weekStart(today, firstDayOfWeek), 6);
  if (date <= thisWeekEnd) return 'thisWeek';
  if (date <= addDays(thisWeekEnd, 7)) return 'nextWeek';
  return 'later';
}

/** Date, then board name, then item position (rows without a date keep the board order). */
export function compareRows(a: MyWorkRow, b: MyWorkRow): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  }
  const byBoard = a.board.name.localeCompare(b.board.name, undefined, { sensitivity: 'base' });
  if (byBoard !== 0) return byBoard;
  if (a.board.id !== b.board.id) return a.board.id < b.board.id ? -1 : 1;
  return comparePositions(a.item, b.item);
}

/** Case-insensitive substring match on the item name, board name and group title. */
export function rowMatchesSearch(row: MyWorkRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return [row.item.name, row.board.name, row.group?.title ?? ''].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

export interface MyWorkSection {
  id: MyWorkBucket;
  title: string;
  rows: MyWorkRow[];
}

/** The non-empty sections, in order, after the search filter. */
export function buildSections(
  rows: readonly MyWorkRow[],
  today: string,
  term: string,
  firstDayOfWeek: FirstDayOfWeek = 'monday',
): MyWorkSection[] {
  const byBucket = new Map<MyWorkBucket, MyWorkRow[]>();
  for (const row of rows) {
    if (!rowMatchesSearch(row, term)) continue;
    const bucket = bucketOf(row, today, firstDayOfWeek);
    const list = byBucket.get(bucket);
    if (list) list.push(row);
    else byBucket.set(bucket, [row]);
  }
  return MY_WORK_BUCKETS.flatMap(({ id, title }) => {
    const list = byBucket.get(id);
    return list ? [{ id, title, rows: list.sort(compareRows) }] : [];
  });
}
