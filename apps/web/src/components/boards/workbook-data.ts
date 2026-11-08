/**
 * The data of the designed Excel workbook (`buildBoardWorkbookParts` in `@atrium/shared`): the
 * Items rows of the export table plus the Summary's figures and breakdowns, computed with the
 * app's own rules so the file shows what the app shows:
 * - status and priority breakdowns: the dashboard Battery widget's `buildBatteryModel`;
 * - done and overdue: the table's `isRowDone` (first status column) and `isBeforeToday` rule;
 * - dates: `itemSpan` of the date views (first Date column, else the end of the first Timeline);
 * - people: `personsOf` of the Workload view (people, not teams).
 * Figures count top-level items; subitems only appear on the Items sheet.
 */
import type {
  BoardWorkbookData,
  ColumnDef,
  WorkbookBreakdown,
  WorkbookCount,
  WorkbookFigures,
} from '@atrium/shared';
import type { BoardDoc, BoardViewDoc, ItemDoc } from '../../data';
import { UNKNOWN_PERSON_NAME } from '../../data/members-store';
import { toIsoDate } from '../../columns/format';
import { comparePositions } from '../../lib/positions';
import { itemSpan } from '../board-date-views/date-view-model';
import { isRowDone } from '../board-table/table-env';
import { buildColumnViews, type ColumnView } from '../board-table/table-model';
import { personsOf } from '../board-workload/workload-model';
import { buildBatteryModel } from '../dashboard/widgets/battery-model';
import { readStatusLabel } from '../dashboard/widgets/widget-columns';
import { buildBoardExportTable, type BoardCsvInput } from './board-export';
import { buildViewSheets } from './view-sheet-data';

/** People rows on the Summary; the rest is counted in a note. */
export const SUMMARY_PEOPLE_CAP = 30;

export interface WorkbookDataInput extends Omit<BoardCsvInput, 'typed'> {
  boardName: string;
  /** The board's views: one sheet per view type (left out for a selection export). */
  views?: readonly BoardViewDoc[];
  /** Every active item of the board for the view sheets; `items` plus `subitems` when unset. */
  allItems?: readonly ItemDoc[];
  /** The export time (tests pass a fixed one). */
  now: Date;
}

const isPriority = (def: ColumnDef) => /priority/i.test(def.title);

const EXPORTED_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return toIsoDate(new Date(y, m - 1, d + days));
};

function statusBreakdown(
  board: Pick<BoardDoc, 'id' | 'columns'>,
  def: ColumnDef,
  items: readonly ItemDoc[],
): WorkbookBreakdown {
  // The Battery model reads only the board's id and columns.
  const model = buildBatteryModel({
    boards: [{ board: board as BoardDoc, items }],
    widgetBoardIds: [],
    settings: { statusColumnId: def.id, doneLabelIds: [] },
  });
  return {
    title: def.title,
    rows: model.segments.map((s) => ({ label: s.label, color: s.color, count: s.count })),
  };
}

export function buildBoardWorkbookData(input: WorkbookDataInput): BoardWorkbookData {
  const table = buildBoardExportTable({ ...input, typed: true });
  const { columns, groups } = input;
  const board = { id: input.board.id, columns: [...columns] };
  const views = buildColumnViews(columns);
  const today = toIsoDate(input.now);
  const weekEnd = addDays(today, 6);

  const top = table.rows.filter((r) => !r.subitem).map((r) => r.item);
  const statusDefs = columns.filter((c) => c.type === 'status');
  const statusDef = statusDefs.find((c) => !isPriority(c)) ?? statusDefs[0] ?? null;
  const priorityDef = statusDefs.find((c) => isPriority(c) && c.id !== statusDef?.id) ?? null;
  const firstStatus: ColumnView | null = views.find((v) => v.def.type === 'status') ?? null;
  const dateView: ColumnView | null =
    views.find((v) => v.def.type === 'date') ??
    views.find((v) => v.def.type === 'timeline') ??
    null;
  const peopleView: ColumnView | null = views.find((v) => v.def.type === 'people') ?? null;

  let done = 0;
  let inProgress = 0;
  let overdue = 0;
  let dueSoon = 0;
  let noDate = 0;
  const people = new Map<string, { count: number; done: number }>();
  let unassigned = { count: 0, done: 0 };
  const byGroup = new Map<string, { count: number; done: number }>();

  for (const item of top) {
    const isDone = firstStatus ? isRowDone(item, views) : false;
    if (isDone) done += 1;
    else if (firstStatus && readStatusLabel(item, firstStatus.def)) inProgress += 1;
    if (dateView) {
      const span = itemSpan(item, dateView);
      if (!span) noDate += 1;
      else if (!isDone && span.to < today) overdue += 1;
      else if (!isDone && span.to >= today && span.to <= weekEnd) dueSoon += 1;
    }
    if (peopleView) {
      const ids = personsOf(item, peopleView);
      if (ids.length === 0) {
        unassigned = { count: unassigned.count + 1, done: unassigned.done + (isDone ? 1 : 0) };
      }
      for (const id of ids) {
        const p = people.get(id) ?? { count: 0, done: 0 };
        p.count += 1;
        if (isDone) p.done += 1;
        people.set(id, p);
      }
    }
    const g = byGroup.get(item.groupId) ?? { count: 0, done: 0 };
    g.count += 1;
    if (isDone) g.done += 1;
    byGroup.set(item.groupId, g);
  }

  const sortedGroups = [...groups].sort(comparePositions);
  const groupColors = new Map(groups.map((g) => [g.id, g.color]));

  let peopleTable: WorkbookBreakdown | null = null;
  if (peopleView) {
    const rows: WorkbookCount[] = [...people]
      .map(([id, p]) => ({
        label: input.personNames(id) ?? UNKNOWN_PERSON_NAME,
        color: null,
        count: p.count,
        done: p.done,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const shown = rows.slice(0, SUMMARY_PEOPLE_CAP);
    if (unassigned.count > 0) {
      shown.push({ label: 'Unassigned', color: null, ...unassigned });
    }
    peopleTable = {
      title: `Workload by ${peopleView.def.title}`,
      rows: shown,
      more: Math.max(0, rows.length - SUMMARY_PEOPLE_CAP),
    };
  }

  const figures: WorkbookFigures = {
    items: top.length,
    groups: groups.length,
    done: firstStatus ? done : null,
    inProgress: firstStatus ? inProgress : null,
    overdue: dateView ? overdue : null,
    dueSoon: dateView ? dueSoon : null,
    noDate: dateView ? noDate : null,
    people: peopleView ? people.size : null,
  };

  const statusLabels = statusDef
    ? [...((statusDef.settings as { labels?: { color: string; index: number }[] }).labels ?? [])]
        .sort((a, b) => a.index - b.index)
        .map((l) => l.color)
    : [];

  const allTop = input.items.filter((i) => i.state === 'active');
  return {
    boardName: input.boardName,
    exportedLabel: EXPORTED_FORMAT.format(input.now),
    createdAt: input.now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    selection: input.itemIds ? { count: top.length, total: allTop.length } : null,
    stripe: statusLabels.length > 0 ? statusLabels : sortedGroups.map((g) => g.color),
    figures,
    status: statusDef ? statusBreakdown(board, statusDef, top) : null,
    priority: priorityDef ? statusBreakdown(board, priorityDef, top) : null,
    groups: {
      title: 'Groups',
      rows: sortedGroups.map((g) => ({
        label: g.title,
        color: g.color,
        count: byGroup.get(g.id)?.count ?? 0,
        done: byGroup.get(g.id)?.done ?? 0,
      })),
    },
    people: peopleTable,
    views:
      input.views && !input.itemIds
        ? buildViewSheets({
            boardId: input.board.id,
            views: input.views,
            items: (input.allItems ?? [...input.items, ...input.subitems]).filter(
              (i) => i.state === 'active',
            ),
            columns,
            groups,
            personNames: input.personNames,
            today,
          })
        : [],
    items: {
      header: table.header,
      hasSubitems: table.hasSubitems,
      rows: table.rows.map((r) => ({
        cells: r.cells,
        groupColor: groupColors.get(r.groupId) ?? null,
        subitem: r.subitem,
      })),
    },
  };
}
