/**
 * Workload widget model (P6): items per person over time across the widget's boards. Pure: no
 * React and no Firebase.
 *
 * The Workload view's `buildWorkload` reads one board's columns by id, so this adapter first
 * normalises every board into one stream: each item becomes a copy whose date sits in a synthetic
 * timeline cell (`__date`, from the board's date or timeline column) and whose people sit in a
 * synthetic People cell (`__people`). One `buildWorkload` call over the merged items then gives a
 * single shared axis and one row per person (people are matched by uid; items nobody owns land in
 * "Unassigned"). The measure is always the item count; the bucket picks weekly or monthly cells.
 *
 * Columns: a saved column id is matched on each board by id, then by type and title
 * (`widget-columns.ts`). With none saved, a board uses its first timeline (else date) column and
 * its first People column. A board without a usable date column is skipped and reported in
 * `skippedBoards`; a board without a People column puts all its items in "Unassigned".
 * Subitems are not counted. Item ids are prefixed with the board id so boards cannot collide.
 */
import { columnRegistry, type DashboardWidget } from '@atrium/shared';
import type { ItemDoc } from '../../../data';
import { itemSpan } from '../../board-date-views/date-view-model';
import { buildColumnViews, type ColumnView } from '../../board-table/table-model';
import { resolveTimelineColumn } from '../../board-timeline/timeline-model';
import { buildWorkload, type WorkloadModel } from '../../board-workload/workload-model';
import { resolveColumn, widgetBoards, type WidgetBoardData } from './widget-columns';

export type WorkloadWidgetSettings = Extract<DashboardWidget, { type: 'workload' }>['settings'];

export const DATE_KEY = '__date';
export const PEOPLE_KEY = '__people';

export interface WorkloadWidgetModel {
  /** `null` when no board has a date column. */
  model: WorkloadModel | null;
  /** Boards read. */
  boardCount: number;
  /** Names of the boards skipped for lack of a date or timeline column. */
  skippedBoards: string[];
  /** Items counted in the grid or listed without a date. */
  itemCount: number;
  summary: string;
}

const syntheticView = (type: string, title: string, id: string): ColumnView => {
  const def = { id, type, title, position: 'a0', settings: {} } as ColumnView['def'];
  return { def, settings: columnRegistry.defaultSettings(type), width: 0 };
};

const DATE_VIEW = syntheticView('timeline', 'Date', DATE_KEY);
const PEOPLE_VIEW = syntheticView('people', 'People', PEOPLE_KEY);

export function buildWorkloadWidgetModel(input: {
  boards: readonly WidgetBoardData[];
  widgetBoardIds: readonly string[];
  settings: WorkloadWidgetSettings;
  /** Today as `YYYY-MM-DD`. */
  today: string;
  nameOf?: (uid: string) => string | undefined;
}): WorkloadWidgetModel {
  const boards = widgetBoards(input.boards, input.widgetBoardIds);
  const allBoards = boards.map((b) => b.board);
  const { settings } = input;

  const merged: ItemDoc[] = [];
  const skippedBoards: string[] = [];
  let boardCount = 0;
  for (const { board, items } of boards) {
    const views = buildColumnViews(board.columns);
    const saved = resolveColumn(allBoards, board, settings.dateColumnId);
    const dateView =
      (saved &&
        views.find((v) => v.def.id === saved.id && ['date', 'timeline'].includes(v.def.type))) ||
      resolveTimelineColumn(views, null);
    if (!dateView) {
      skippedBoards.push(board.name);
      continue;
    }
    boardCount += 1;
    const peopleSaved = resolveColumn(allBoards, board, settings.peopleColumnId);
    const peopleView =
      (peopleSaved && views.find((v) => v.def.id === peopleSaved.id && v.def.type === 'people')) ||
      views.find((v) => v.def.type === 'people') ||
      null;
    for (const item of items) {
      if (item.parentItemId != null) continue;
      const span = itemSpan(item, dateView);
      const values: Record<string, unknown> = {};
      if (span) values[DATE_KEY] = { from: span.from, to: span.to };
      if (peopleView) values[PEOPLE_KEY] = item.values[peopleView.def.id];
      merged.push({ ...item, id: `${board.id}:${item.id}`, values });
    }
  }

  if (boardCount === 0) {
    return {
      model: null,
      boardCount,
      skippedBoards,
      itemCount: 0,
      summary: 'Workload: no board has a date or timeline column',
    };
  }

  const model = buildWorkload({
    items: merged,
    columns: [DATE_VIEW, PEOPLE_VIEW],
    dateColumn: DATE_VIEW,
    peopleColumn: PEOPLE_VIEW,
    search: '',
    settings: {
      zoom: settings.bucket === 'month' ? 'months' : 'weeks',
      measure: 'count',
      capacityPerDay: null,
      showWeekends: false,
    },
    today: input.today,
    nameOf: input.nameOf,
  });
  const people = model.rows.filter((r) => r.id !== '__unassigned').length;
  return {
    model,
    boardCount,
    skippedBoards,
    itemCount: merged.length,
    summary: `Workload of ${people} ${people === 1 ? 'person' : 'people'} over ${model.axis.cells.length} ${settings.bucket === 'month' ? 'months' : 'weeks'}`,
  };
}
