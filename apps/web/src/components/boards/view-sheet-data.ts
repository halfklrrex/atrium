/**
 * The data of the workbook's view sheets (spec `P6-export-workbook.md`, "View sheets"): one sheet
 * per view type, from the first view of that type in tab order, computed with the view's own model
 * and saved settings (its filters and sort; the open view's search does not apply):
 * - Kanban: `resolveStatusColumn`, `resolveCardColumns`, `buildKanbanLanes`;
 * - Calendar: `resolveCalendarColumn`, `selectItems`, `itemSpan`, `itemColor`;
 * - Timeline and Gantt: `resolveTimelineColumn`, `buildTimeline`, and for Gantt `buildEdges` and
 *   `criticalPath`;
 * - Chart: `buildChartModel`;
 * - Workload: `resolveWorkloadColumns`, `buildWorkload`.
 */
import {
  CALENDAR_SHEET_MONTHS,
  KANBAN_SHEET_CARDS,
  TIMELINE_SHEET_ITEMS,
  WORKLOAD_SHEET_PERIODS,
  defaultCalendarSettings,
  defaultChartSettings,
  defaultGanttSettings,
  defaultKanbanSettings,
  defaultTimelineViewSettings,
  defaultWorkloadSettings,
  monthFirstDate,
  type BoardFilterState,
  type CalendarEntry,
  type ColumnDef,
  type GroupDef,
  type TimelineRow,
  type ViewSheetData,
  type ViewType,
} from '@atrium/shared';
import type { BoardViewDoc, ItemDoc } from '../../data';
import { comparePositions } from '../../lib/positions';
import { resolveCalendarColumn } from '../board-calendar/calendar-model';
import { buildChartModel } from '../board-chart/chart-model';
import {
  itemColor,
  itemSpan,
  resolveColorColumn,
  selectItems,
} from '../board-date-views/date-view-model';
import { buildEdges, criticalPath, resolveDependencyColumn } from '../board-gantt/gantt-model';
import {
  buildKanbanLanes,
  resolveCardColumns,
  resolveStatusColumn,
} from '../board-kanban/kanban-model';
import { buildColumnViews, type ColumnView } from '../board-table/table-model';
import { buildTimeline, resolveTimelineColumn } from '../board-timeline/timeline-model';
import { buildWorkload, resolveWorkloadColumns } from '../board-workload/workload-model';
import { exportCellText } from './board-export';

/** Days of one item a Calendar lists it on (a long timeline item is not repeated forever). */
export const CALENDAR_SPAN_DAYS = 62;

export interface ViewSheetInput {
  boardId: string;
  views: readonly BoardViewDoc[];
  /** Every active item of the board (subitems included; the models skip them). */
  items: readonly ItemDoc[];
  columns: readonly ColumnDef[];
  groups: readonly GroupDef[];
  personNames: (uid: string) => string | undefined;
  /** `YYYY-MM-DD`. */
  today: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
/** A hex colour, or `null` for a CSS variable (the chart's "Empty" and "Other" tokens). */
const hexOrNull = (color: string | null | undefined): string | null =>
  color && HEX.test(color) ? color : null;

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

const SHEET_TYPES: readonly ViewType[] = [
  'kanban',
  'calendar',
  'timeline',
  'gantt',
  'chart',
  'workload',
];

interface Ctx {
  input: ViewSheetInput;
  columns: ColumnView[];
  groupColor: Map<string, string>;
  itemNames: Map<string, string>;
}

const filterOf = (view: BoardViewDoc): BoardFilterState | undefined => view.settings?.filter;

function kanban(ctx: Ctx, view: BoardViewDoc): ViewSheetData {
  const settings = view.settings.kanban ?? defaultKanbanSettings();
  const status = resolveStatusColumn(ctx.columns, settings.columnId);
  if (!status) {
    return { type: 'kanban', name: view.name, columnTitle: 'Status', cardColumns: [], lanes: [] };
  }
  const cardColumns = resolveCardColumns(ctx.columns, settings, status.def.id);
  const lanes = buildKanbanLanes({
    items: ctx.input.items,
    status,
    columns: ctx.columns,
    filterState: filterOf(view),
    search: '',
    kanban: { collapsedLaneIds: [], showEmptyLanes: settings.showEmptyLanes },
  });
  return {
    type: 'kanban',
    name: view.name,
    columnTitle: status.def.title,
    cardColumns: cardColumns.map((c) => c.def.title),
    lanes: lanes.map((lane) => ({
      title: lane.title,
      color: hexOrNull(lane.color),
      total: lane.items.length,
      cards: lane.items.slice(0, KANBAN_SHEET_CARDS).map((item) => ({
        name: item.name,
        groupColor: ctx.groupColor.get(item.groupId) ?? null,
        lines: cardColumns.map((c) => {
          const text = exportCellText(
            c,
            ctx.input.columns,
            item,
            ctx.input.boardId,
            ctx.input.personNames,
            ctx.itemNames,
          );
          // Dates read like the workbook's date cells ("Nov 2, 2026"); the CSV keeps ISO.
          const shown = c.def.type === 'date' ? monthFirstDate(text) : text;
          return shown ? `${c.def.title}: ${shown.replace(/\s*\n\s*/g, ' ')}` : '';
        }),
      })),
    })),
  };
}

function calendar(ctx: Ctx, view: BoardViewDoc): ViewSheetData {
  const settings = view.settings.calendar ?? defaultCalendarSettings();
  const column = resolveCalendarColumn(ctx.columns, settings.columnId);
  const base = {
    type: 'calendar' as const,
    name: view.name,
    firstDayOfWeek: settings.firstDayOfWeek,
    today: ctx.input.today,
  };
  if (!column) return { ...base, columnTitle: 'Date', months: [], entries: {}, note: null };
  const colorColumn = resolveColorColumn(ctx.columns, settings.colorBy);
  const shown = selectItems({
    items: ctx.input.items,
    columns: ctx.columns,
    filterState: filterOf(view),
    search: '',
  });
  const entries: Record<string, CalendarEntry[]> = {};
  let min: string | null = null;
  let max: string | null = null;
  for (const item of shown) {
    const span = itemSpan(item, column);
    if (!span) continue;
    const entry = {
      name: item.name,
      color: hexOrNull(itemColor(item, colorColumn, ctx.groupColor)),
    };
    for (let i = 0, day = span.from; day <= span.to && i < CALENDAR_SPAN_DAYS; i += 1) {
      (entries[day] ??= []).push(entry);
      if (min === null || day < min) min = day;
      if (max === null || day > max) max = day;
      day = addDays(day, 1);
    }
  }
  const months: string[] = [];
  if (min !== null && max !== null) {
    for (let m = min.slice(0, 7); m <= max.slice(0, 7); m = nextMonth(m)) months.push(m);
  }
  const capped = months.length > CALENDAR_SHEET_MONTHS;
  return {
    ...base,
    columnTitle: column.def.title,
    months: capped ? months.slice(-CALENDAR_SHEET_MONTHS) : months,
    entries,
    note: capped
      ? `Only the last ${CALENDAR_SHEET_MONTHS} of ${months.length} months are drawn.`
      : null,
  };
}

function timeline(ctx: Ctx, view: BoardViewDoc, type: 'timeline' | 'gantt'): ViewSheetData {
  const gantt = view.settings.gantt ?? defaultGanttSettings();
  const settings =
    type === 'gantt' ? gantt : (view.settings.timeline ?? defaultTimelineViewSettings());
  const column = resolveTimelineColumn(ctx.columns, settings.columnId);
  const base = { type, name: view.name, today: ctx.input.today };
  if (!column) return { ...base, columnTitle: 'Timeline', rows: [], note: null };
  const model = buildTimeline({
    items: ctx.input.items,
    column,
    columns: ctx.columns,
    groups: ctx.input.groups,
    filterState: filterOf(view),
    search: '',
    settings: { ...settings, collapsedGroupIds: [] },
    today: ctx.input.today,
  });
  const dependsOn = new Map<string, string[]>();
  let critical = new Set<string>();
  if (type === 'gantt') {
    const dependency = resolveDependencyColumn(ctx.columns, gantt.dependencyColumnId);
    const edges = buildEdges(model, dependency?.def.id ?? null);
    for (const edge of edges) {
      const list = dependsOn.get(edge.to.id) ?? [];
      list.push(edge.from.name);
      dependsOn.set(edge.to.id, list);
    }
    critical = new Set(criticalPath(edges).ids);
  }
  const shownCount = selectItems({
    items: ctx.input.items,
    columns: ctx.columns,
    filterState: filterOf(view),
    search: '',
  }).length;
  const rows: TimelineRow[] = [];
  let drawn = 0;
  let total = 0;
  for (const lane of model.lanes) {
    if (lane.bars.length === 0) continue;
    total += lane.bars.length;
    const room = TIMELINE_SHEET_ITEMS - drawn;
    if (room <= 0) continue;
    rows.push({ kind: 'group', title: lane.group.title, color: hexOrNull(lane.group.color) });
    const bars = [...lane.bars].sort((a, b) => a.order - b.order).slice(0, room);
    for (const bar of bars) {
      rows.push({
        kind: 'item',
        name: bar.name,
        from: bar.from,
        to: bar.to,
        color: hexOrNull(bar.color),
        groupColor: hexOrNull(lane.group.color),
        ...(type === 'gantt'
          ? {
              dependsOn: (dependsOn.get(bar.key) ?? []).join(', '),
              critical: critical.has(bar.key),
            }
          : {}),
      });
    }
    drawn += bars.length;
  }
  const notes: string[] = [];
  if (total > drawn) notes.push(`Showing the first ${drawn} of ${total} items.`);
  const undated = shownCount - total;
  if (undated > 0) notes.push(`${undated} ${undated === 1 ? 'item has' : 'items have'} no date.`);
  return { ...base, columnTitle: column.def.title, rows, note: notes.join(' ') || null };
}

function chart(ctx: Ctx, view: BoardViewDoc): ViewSheetData {
  const settings = view.settings.chart ?? defaultChartSettings();
  const model = buildChartModel({
    items: ctx.input.items,
    columns: ctx.columns,
    groups: ctx.input.groups,
    settings,
    filterState: filterOf(view),
    search: '',
    userName: ctx.input.personNames,
  });
  const stacked = model.chartType === 'stacked_bar';
  const series = stacked
    ? model.series.map((s, i) => ({ label: s.label, color: hexOrNull(s.color) ?? fallback(i) }))
    : [];
  return {
    type: 'chart',
    name: view.name,
    chartType: model.chartType,
    title: model.title,
    xTitle: model.xTitle,
    yLabel: model.yLabel,
    buckets: model.buckets.map((b) => ({
      label: b.label,
      color: model.coloredBuckets ? hexOrNull(b.color) : null,
      value: b.value,
    })),
    series,
    stacked: stacked
      ? model.buckets.map((b) =>
          model.series.map((s) => b.segments.find((seg) => seg.seriesKey === s.key)?.value ?? 0),
        )
      : [],
    notes: [...model.notes, ...(model.yFallback ? [model.yFallback] : [])],
    showLegend: settings.showLegend,
    showValues: settings.showValues,
  };
}

/** Series colours for tokens a workbook cannot read: grey for "Empty" and "Other". */
const fallback = (i: number) => (i % 2 === 0 ? '#C4C4C4' : '#676879');

function workload(ctx: Ctx, view: BoardViewDoc): ViewSheetData | null {
  const settings = view.settings.workload ?? defaultWorkloadSettings();
  const cols = resolveWorkloadColumns(ctx.columns, settings);
  const peopleTitle = cols.peopleColumn?.def.title ?? 'Person';
  const base = { type: 'workload' as const, name: view.name, peopleTitle };
  if (!cols.dateColumn) {
    return { ...base, measureLabel: 'Items', periods: [], rows: [], note: 'No date column.' };
  }
  const model = buildWorkload({
    items: ctx.input.items,
    columns: ctx.columns,
    dateColumn: cols.dateColumn,
    peopleColumn: cols.peopleColumn,
    sumColumn: cols.sumColumn,
    filterState: filterOf(view),
    search: '',
    settings,
    today: ctx.input.today,
    nameOf: ctx.input.personNames,
  });
  const cells = model.rows[0]?.cells ?? [];
  let start = 0;
  let note: string | null = null;
  if (cells.length > WORKLOAD_SHEET_PERIODS) {
    const todayAt = Math.max(
      0,
      cells.findIndex((c) => c.today),
    );
    start = Math.min(
      Math.max(0, todayAt - Math.floor(WORKLOAD_SHEET_PERIODS / 4)),
      cells.length - WORKLOAD_SHEET_PERIODS,
    );
    note = `Showing ${WORKLOAD_SHEET_PERIODS} of ${cells.length} periods around today.`;
  }
  const end = start + Math.min(cells.length, WORKLOAD_SHEET_PERIODS);
  return {
    ...base,
    measureLabel:
      model.measure === 'sum' && cols.sumColumn ? `Sum of ${cols.sumColumn.def.title}` : 'Items',
    periods: cells.slice(start, end).map((c) => ({ label: c.label, today: c.today })),
    rows: model.rows.map((r) => {
      const window = r.cells.slice(start, end);
      return {
        name: r.name,
        values: window.map((c) => c.value),
        levels: window.map((c) => c.level),
        total: window.reduce((n, c) => n + c.value, 0),
      };
    }),
    note,
  };
}

/** The view sheets of a board: the first view of each type, in tab order. */
export function buildViewSheets(input: ViewSheetInput): ViewSheetData[] {
  const ctx: Ctx = {
    input,
    columns: buildColumnViews(input.columns),
    groupColor: new Map(input.groups.map((g) => [g.id, g.color])),
    itemNames: new Map(input.items.map((i) => [i.id, i.name])),
  };
  const ordered = [...input.views].sort(comparePositions);
  const out: ViewSheetData[] = [];
  for (const type of SHEET_TYPES) {
    const view = ordered.find((v) => v.type === type);
    if (!view) continue;
    let data: ViewSheetData | null;
    switch (type) {
      case 'kanban':
        data = kanban(ctx, view);
        break;
      case 'calendar':
        data = calendar(ctx, view);
        break;
      case 'timeline':
      case 'gantt':
        data = timeline(ctx, view, type);
        break;
      case 'chart':
        data = chart(ctx, view);
        break;
      default:
        data = workload(ctx, view);
    }
    if (data) out.push(data);
  }
  return out;
}
