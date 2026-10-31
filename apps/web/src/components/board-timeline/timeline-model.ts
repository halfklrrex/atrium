/**
 * Pure model of the Timeline view: which column places the items, the day axis and its two header
 * rows, one lane per board group with its summary line, items packed into as few rows as fit (a
 * bar and the name beside it count), and what a drag or a key press writes. No React and no
 * Firebase, so it is unit tested.
 */
import {
  columnRegistry,
  type BoardFilterState,
  type DateValue,
  type GroupDef,
  type TimelineValue,
  type TimelineViewSettings,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';
import {
  SHORT_MONTHS,
  WEEKDAY_NAMES,
  addDays,
  diffDays,
  inclusiveSpan,
  isoWeekNumber,
  isWeekend,
  monthEnd,
  monthStart,
  parseIsoDay,
  shortDateLabel,
  weekStart,
  fullDateLabel,
  MONTH_NAMES,
} from '../../lib/date-grid';
import { comparePositions } from '../../lib/positions';
import {
  buildLegend,
  itemColor,
  itemSpan,
  resolveColorColumn,
  selectItems,
  textToneFor,
  type DatePatches,
  type LegendEntry,
} from '../board-date-views/date-view-model';
import type { ColumnView } from '../board-table/table-model';

export type TimelineZoom = TimelineViewSettings['zoom'];

/** Column types that can place an item on the timeline. */
export const TIMELINE_COLUMN_TYPES = ['timeline', 'date'] as const;

/** Pixels per day on the axis for each zoom. */
export const ZOOM_DAY_WIDTH: Record<TimelineZoom, number> = { days: 40, weeks: 16, months: 4 };

/** A bar is never narrower than this (a one-day bar at the months zoom is a small square). */
export const MIN_BAR_PX = 12;
/** Estimated width of one character of a bar's name, and the padding inside a bar. */
export const LABEL_CHAR_PX = 7;
export const BAR_PADDING_PX = 16;
/** Space kept between two items in one row. */
export const ROW_GAP_PX = 8;
/** Beyond this many rows the view only renders the lanes and rows in view. */
export const WINDOW_THRESHOLD_ROWS = 200;
/** The axis never grows past this many days either side of today (an item far away is clipped). */
export const MAX_AXIS_DAYS = 1500;

/** The saved column if it is still a timeline or date column, else the first timeline, else the first date. */
export function resolveTimelineColumn(
  columns: readonly ColumnView[],
  columnId: string | null,
): ColumnView | null {
  const usable = columns.filter((c) => c.def.type === 'timeline' || c.def.type === 'date');
  return (
    usable.find((c) => c.def.id === columnId) ??
    usable.find((c) => c.def.type === 'timeline') ??
    usable.find((c) => c.def.type === 'date') ??
    null
  );
}

// ---- Axis ----

/** One cell of a header row: where it starts on the axis (in displayed days) and how many it spans. */
export interface AxisCell {
  key: string;
  label: string;
  startIdx: number;
  span: number;
  /** The cell holds today. */
  today: boolean;
}

export interface TimelineAxis {
  /** The displayed days, in order (weekend days left out when asked, at the days zoom). */
  days: string[];
  /** Upper header row: months (or years at the months zoom). */
  top: AxisCell[];
  /** Lower header row: days, weeks or months. */
  cells: AxisCell[];
  /** Index of the first displayed day on or after `iso` (days.length when there is none). */
  lowerBound: (iso: string) => number;
  /** The day at an axis index; past either end it carries on by calendar days. */
  dayAt: (index: number) => string;
}

function groupCells(
  days: readonly string[],
  today: string,
  keyOf: (day: string) => string,
  labelOf: (first: string, last: string) => string,
): AxisCell[] {
  const cells: AxisCell[] = [];
  days.forEach((day, i) => {
    const key = keyOf(day);
    const last = cells[cells.length - 1];
    if (last && last.key === key) {
      last.span += 1;
      last.today ||= day === today;
    } else {
      cells.push({ key, label: day, startIdx: i, span: 1, today: day === today });
    }
  });
  // Labels need the first and last day of each cell.
  for (const cell of cells)
    cell.label = labelOf(days[cell.startIdx]!, days[cell.startIdx + cell.span - 1]!);
  return cells;
}

const dayOfMonth = (iso: string): number => parseIsoDay(iso).getUTCDate();

/** "Tu 18": two letters of the weekday, then the date. */
const dayLabel = (iso: string): string =>
  `${WEEKDAY_NAMES[parseIsoDay(iso).getUTCDay()]!.slice(0, 2)} ${dayOfMonth(iso)}`;

/** "W43 19 - 25" (or "W44 26 - Nov 1" across months). */
function weekLabel(first: string, last: string): string {
  const end =
    first.slice(0, 7) === last.slice(0, 7)
      ? `${dayOfMonth(last)}`
      : `${SHORT_MONTHS[parseIsoDay(last).getUTCMonth()]} ${dayOfMonth(last)}`;
  return `W${isoWeekNumber(first)} ${dayOfMonth(first)} - ${end}`;
}

export function buildAxis(
  from: string,
  to: string,
  zoom: TimelineZoom,
  showWeekends: boolean,
  today: string,
): TimelineAxis {
  let start = from;
  let end = to;
  if (zoom === 'weeks') {
    start = weekStart(start, 'monday');
    end = addDays(weekStart(end, 'monday'), 6);
  } else if (zoom === 'months') {
    start = monthStart(start);
    end = monthEnd(end);
  }
  const all: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (zoom === 'days' && !showWeekends && isWeekend(day)) continue;
    all.push(day);
  }
  const days = all;

  const cells =
    zoom === 'days'
      ? groupCells(
          days,
          today,
          (d) => d,
          (first) => dayLabel(first),
        )
      : zoom === 'weeks'
        ? groupCells(days, today, (d) => weekStart(d, 'monday'), weekLabel)
        : groupCells(
            days,
            today,
            (d) => d.slice(0, 7),
            (first) => SHORT_MONTHS[parseIsoDay(first).getUTCMonth()]!,
          );
  const top =
    zoom === 'months'
      ? groupCells(
          days,
          today,
          (d) => d.slice(0, 4),
          (first) => first.slice(0, 4),
        )
      : groupCells(
          days,
          today,
          (d) => d.slice(0, 7),
          (first) => `${MONTH_NAMES[parseIsoDay(first).getUTCMonth()]} ${first.slice(0, 4)}`,
        );

  const lowerBound = (iso: string): number => {
    let lo = 0;
    let hi = days.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (days[mid]! < iso) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const dayAt = (index: number): string => {
    if (days.length === 0) return today;
    if (index < 0) return addDays(days[0]!, index);
    if (index >= days.length) return addDays(days[days.length - 1]!, index - days.length + 1);
    return days[index]!;
  };
  return { days, top, cells, lowerBound, dayAt };
}

// ---- Items, lanes and rows ----

export interface TimelineBar {
  /** The item id (one bar per item). */
  key: string;
  item: ItemDoc;
  name: string;
  /** Screen-reader name: "Name, Oct 3 to Oct 17". */
  label: string;
  /** The item's real first and last day. */
  from: string;
  to: string;
  isRange: boolean;
  /** First and last displayed axis index the bar covers. */
  startIdx: number;
  endIdx: number;
  /** Packed row within the lane's items (0 = first, below the summary). */
  row: number;
  /** Index of the item in the view's order. */
  order: number;
  /** The bar is narrower than its name, so the name is drawn after it. */
  labelOutside: boolean;
  continuesBefore: boolean;
  continuesAfter: boolean;
  color: string | null;
  tone: 'dark' | 'light';
}

export interface TimelineLane {
  group: GroupDef;
  collapsed: boolean;
  bars: TimelineBar[];
  /** Rows of bars (0 when collapsed). */
  rowCount: number;
  /** Rows the lane occupies in all: the summary row (when shown) plus the bar rows. */
  heightRows: number;
  /** The row the summary takes (1 when shown, or when collapsed, else 0). */
  summaryRows: number;
  summary: {
    from: string;
    to: string;
    startIdx: number;
    endIdx: number;
    rangeText: string;
    daysText: string;
  } | null;
}

export interface BuildTimelineInput {
  items: readonly ItemDoc[];
  column: ColumnView;
  columns: readonly ColumnView[];
  groups: readonly GroupDef[];
  filterState?: BoardFilterState;
  search: string;
  patches?: DatePatches;
  settings: Pick<
    TimelineViewSettings,
    'zoom' | 'colorBy' | 'collapsedGroupIds' | 'showGroupSummary' | 'showWeekends'
  >;
  /** Today as `YYYY-MM-DD`. */
  today: string;
}

export interface TimelineModel {
  axis: TimelineAxis;
  lanes: TimelineLane[];
  zoom: TimelineZoom;
  dayWidth: number;
  /** Axis index of today (the first displayed day on or after it). */
  todayIdx: number;
  legend: LegendEntry[];
  totalRows: number;
  /** Ids of the items drawn, lane by lane (the full item view steps through them). */
  visibleIdsByLane: { groupId: string; ids: string[] }[];
  /** No item has a value in the column. */
  noDates: boolean;
}

/** "Oct 3 - 17", "Oct 28 - Nov 4" or, across years, "Dec 28, 2026 - Jan 3, 2027". */
export function summaryRange(from: string, to: string): string {
  if (from === to) return shortDateLabel(from);
  const a = parseIsoDay(from);
  const b = parseIsoDay(to);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) {
    return `${shortDateLabel(from)}, ${a.getUTCFullYear()} - ${shortDateLabel(to)}, ${b.getUTCFullYear()}`;
  }
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${shortDateLabel(from)} - ${b.getUTCDate()}`
    : `${shortDateLabel(from)} - ${shortDateLabel(to)}`;
}

const daysText = (from: string, to: string): string => {
  const n = inclusiveSpan(from, to);
  return `${n} ${n === 1 ? 'day' : 'days'}`;
};

/** Estimated width of a bar's name in pixels. */
export const labelWidthPx = (name: string): number => Math.ceil(name.length * LABEL_CHAR_PX);

/**
 * Pack bars into rows, greedily: sorted by start, each goes on the first row where it clears the
 * previous bar, and the name drawn after it when the bar is narrower than the name.
 * Mutates `row` and `labelOutside` on the bars; returns the number of rows.
 */
export function packRows(bars: TimelineBar[], dayWidth: number): number {
  const ordered = [...bars].sort(
    (a, b) => a.startIdx - b.startIdx || b.endIdx - a.endIdx || a.order - b.order,
  );
  const rowEnds: number[] = [];
  for (const bar of ordered) {
    const x0 = bar.startIdx * dayWidth;
    const barWidth = Math.max((bar.endIdx - bar.startIdx + 1) * dayWidth, MIN_BAR_PX);
    const label = labelWidthPx(bar.name);
    bar.labelOutside = barWidth < label + BAR_PADDING_PX;
    const reach = bar.labelOutside ? x0 + barWidth + ROW_GAP_PX / 2 + label : x0 + barWidth;
    let row = rowEnds.findIndex((end) => end + ROW_GAP_PX <= x0);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = reach;
    bar.row = row;
  }
  return rowEnds.length;
}

/** The first and last day to show: the items' range (and today), padded, within the axis limits. */
function axisRange(
  spans: readonly { from: string; to: string }[],
  zoom: TimelineZoom,
  today: string,
): { from: string; to: string } {
  let from = today;
  let to = today;
  for (const span of spans) {
    if (span.from < from) from = span.from;
    if (span.to > to) to = span.to;
  }
  const pad = { days: [7, 14], weeks: [14, 35], months: [31, 62] }[zoom] as [number, number];
  from = addDays(from, -pad[0]);
  to = addDays(to, pad[1]);
  const lowest = addDays(today, -MAX_AXIS_DAYS);
  const highest = addDays(today, MAX_AXIS_DAYS);
  return { from: from < lowest ? lowest : from, to: to > highest ? highest : to };
}

export function buildTimeline(input: BuildTimelineInput): TimelineModel {
  const { column, columns, groups, filterState, search, patches, settings, today } = input;
  const colorColumn = resolveColorColumn(columns, settings.colorBy);
  const groupColor = new Map(groups.map((g) => [g.id, g.color]));
  const collapsed = new Set(settings.collapsedGroupIds);
  const dayWidth = ZOOM_DAY_WIDTH[settings.zoom];

  const shown = selectItems({ items: input.items, columns, filterState, search });
  const placed = shown.flatMap((item, order) => {
    const span = itemSpan(item, column, patches?.[item.id]);
    return span ? [{ item, span, order }] : [];
  });

  const range = axisRange(
    placed.map((p) => p.span),
    settings.zoom,
    today,
  );
  const axis = buildAxis(range.from, range.to, settings.zoom, settings.showWeekends, today);
  const days = axis.days;

  const bars = new Map<string, TimelineBar[]>();
  const spansByGroup = new Map<string, { from: string; to: string }[]>();
  for (const { item, span, order } of placed) {
    const startIdx = axis.lowerBound(span.from);
    // The last displayed day on or before `to`.
    const endIdx = axis.lowerBound(addDays(span.to, 1)) - 1;
    if (startIdx >= days.length || endIdx < startIdx) continue;
    const color = itemColor(item, colorColumn, groupColor);
    const rangeText =
      span.from === span.to
        ? fullDateLabel(span.from)
        : `${shortDateLabel(span.from)} to ${shortDateLabel(span.to)}`;
    const bar: TimelineBar = {
      key: item.id,
      item,
      name: item.name,
      label: `${item.name}, ${rangeText}`,
      from: span.from,
      to: span.to,
      isRange: span.isRange,
      startIdx,
      endIdx,
      row: 0,
      order,
      labelOutside: false,
      continuesBefore: span.from < days[0]!,
      continuesAfter: span.to > days[days.length - 1]!,
      color,
      tone: textToneFor(color),
    };
    const list = bars.get(item.groupId) ?? [];
    list.push(bar);
    bars.set(item.groupId, list);
    const spans = spansByGroup.get(item.groupId) ?? [];
    spans.push({ from: span.from, to: span.to });
    spansByGroup.set(item.groupId, spans);
  }

  const lanes: TimelineLane[] = [];
  for (const group of [...groups].sort(comparePositions)) {
    const laneBars = bars.get(group.id);
    if (!laneBars || laneBars.length === 0) continue;
    const spans = spansByGroup.get(group.id)!;
    const from = spans.reduce((min, s) => (s.from < min ? s.from : min), spans[0]!.from);
    const to = spans.reduce((max, s) => (s.to > max ? s.to : max), spans[0]!.to);
    const isCollapsed = collapsed.has(group.id);
    const rowCount = packRows(laneBars, dayWidth);
    laneBars.sort((a, b) => a.row - b.row || a.startIdx - b.startIdx || a.order - b.order);
    const summaryRows = settings.showGroupSummary || isCollapsed ? 1 : 0;
    lanes.push({
      group,
      collapsed: isCollapsed,
      bars: laneBars,
      rowCount: isCollapsed ? 0 : rowCount,
      summaryRows,
      heightRows: Math.max(1, summaryRows + (isCollapsed ? 0 : rowCount)),
      summary:
        summaryRows === 0
          ? null
          : {
              from,
              to,
              startIdx: Math.min(axis.lowerBound(from), days.length - 1),
              endIdx: Math.max(0, axis.lowerBound(addDays(to, 1)) - 1),
              rangeText: summaryRange(from, to),
              daysText: daysText(from, to),
            },
    });
  }

  return {
    axis,
    lanes,
    zoom: settings.zoom,
    dayWidth,
    todayIdx: axis.lowerBound(today),
    legend: buildLegend(colorColumn, groups),
    totalRows: lanes.reduce((sum, l) => sum + l.heightRows, 0),
    visibleIdsByLane: lanes
      .filter((l) => !l.collapsed)
      .map((l) => ({
        groupId: l.group.id,
        ids: [...l.bars].sort((a, b) => a.order - b.order).map((b) => b.key),
      })),
    noDates: placed.length === 0,
  };
}

// ---- Windowing ----

export interface LaneWindow {
  lane: TimelineLane;
  /** First row of the lane within the whole body. */
  topRow: number;
  /** Whether to render the lane's content (false = an empty spacer of the lane's height). */
  render: boolean;
  /** Bar rows to render, relative to the lane's items (inclusive from, exclusive to). */
  rowFrom: number;
  rowTo: number;
}

/**
 * Which lanes and rows to render for a viewport of rows `[firstRow, lastRow]`. Everything renders
 * until the body has more than `WINDOW_THRESHOLD_ROWS` rows; after that only the lanes and rows
 * within the viewport and `overscan` rows either side.
 */
export function windowLanes(
  lanes: readonly TimelineLane[],
  firstRow: number,
  lastRow: number,
  overscan = 20,
): LaneWindow[] {
  const total = lanes.reduce((sum, l) => sum + l.heightRows, 0);
  const everything = total <= WINDOW_THRESHOLD_ROWS;
  let top = 0;
  return lanes.map((lane) => {
    const topRow = top;
    top += lane.heightRows;
    if (everything) return { lane, topRow, render: true, rowFrom: 0, rowTo: lane.rowCount };
    const bottom = topRow + lane.heightRows;
    const render = bottom >= firstRow - overscan && topRow <= lastRow + overscan;
    // Bar rows start after the summary row.
    const first = topRow + lane.summaryRows;
    return {
      lane,
      topRow,
      render,
      rowFrom: Math.max(0, firstRow - overscan - first),
      rowTo: Math.min(lane.rowCount, lastRow + overscan - first + 1),
    };
  });
}

// ---- Changes: drags and keys ----

export interface ChangePlan {
  /** The column's new value, ready for `tableActions.setCell`. */
  value: DateValue | TimelineValue;
  from: string;
  to: string;
}

export type BarChange =
  { kind: 'move'; days: number } | { kind: 'start'; day: string } | { kind: 'end'; day: string };

/** What a change to an item's bar writes, or `null` for no value, no move, or a resize of a date. */
export function planBarChange(
  item: ItemDoc,
  column: ColumnView,
  change: BarChange,
): ChangePlan | null {
  const raw = item.values[column.def.id];
  if (raw === null || raw === undefined) return null;
  const parsed = columnRegistry.parseValue(column.def.type, raw);
  if (!parsed.success) return null;
  if (column.def.type !== 'timeline') {
    if (change.kind !== 'move' || change.days === 0) return null;
    const value = parsed.data as DateValue;
    const date = addDays(value.date, change.days);
    return { value: { ...value, date }, from: date, to: date };
  }
  const value = parsed.data as TimelineValue;
  let { from, to } = value;
  if (change.kind === 'move') {
    if (change.days === 0) return null;
    from = addDays(from, change.days);
    to = addDays(to, change.days);
  } else if (change.kind === 'start') {
    // Never past the other end: a bar is at least one day long.
    from = change.day > to ? to : change.day;
  } else {
    to = change.day < from ? from : change.day;
  }
  if (from === value.from && to === value.to) return null;
  return { value: { from, to }, from, to };
}

export type DragKind = 'move' | 'start' | 'end';

/** The bar's displayed range after dragging it by `k` axis days, and the k that was kept. */
export function resolveDrag(
  bar: Pick<TimelineBar, 'startIdx' | 'endIdx'>,
  kind: DragKind,
  k: number,
): { startIdx: number; endIdx: number; k: number } {
  if (kind === 'move') return { startIdx: bar.startIdx + k, endIdx: bar.endIdx + k, k };
  if (kind === 'start') {
    const kept = Math.min(k, bar.endIdx - bar.startIdx);
    return { startIdx: bar.startIdx + kept, endIdx: bar.endIdx, k: kept };
  }
  const kept = Math.max(k, bar.startIdx - bar.endIdx);
  return { startIdx: bar.startIdx, endIdx: bar.endIdx + kept, k: kept };
}

/** The write of dragging a bar by `k` axis days (a move, or an edge for a resize). */
export function planDrag(
  bar: TimelineBar,
  column: ColumnView,
  axis: TimelineAxis,
  kind: DragKind,
  k: number,
): ChangePlan | null {
  const resolved = resolveDrag(bar, kind, k);
  if (resolved.k === 0) return null;
  if (kind === 'move') {
    const shift = diffDays(axis.dayAt(bar.startIdx), axis.dayAt(resolved.startIdx));
    return planBarChange(bar.item, column, { kind: 'move', days: shift });
  }
  return planBarChange(bar.item, column, {
    kind,
    day: kind === 'start' ? axis.dayAt(resolved.startIdx) : axis.dayAt(resolved.endIdx),
  });
}

/** "Oct 3 - Oct 17" (or "Oct 3" for one day): the tooltip while a bar is dragged. */
export function dragRangeText(from: string, to: string): string {
  return from === to ? shortDateLabel(from) : `${shortDateLabel(from)} - ${shortDateLabel(to)}`;
}
