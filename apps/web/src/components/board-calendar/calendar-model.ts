/**
 * Pure model of the Calendar view: which column places the items, which items land on which days
 * of the shown month or week, how multi-day items split into week-row bars and stack into lanes,
 * what colour each gets, and what a drag writes. No React and no Firebase, so it is unit tested.
 */
import {
  columnRegistry,
  matchesFilter,
  sortItems,
  type BoardFilterState,
  type CalendarSettings,
  type DateValue,
  type GroupDef,
  type StatusSettings,
  type TimelineValue,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';
import {
  addDays,
  addMonths,
  diffDays,
  fullDateLabel,
  monthGrid,
  monthTitle,
  rangeTitle,
  shortDateLabel,
  weekDays,
  type FirstDayOfWeek,
} from '../../lib/date-grid';
import { comparePositions } from '../../lib/positions';
import { cardLabel } from '../board-kanban/kanban-model';
import { itemMatchesSearch, type ColumnView } from '../board-table/table-model';

/** Column types that can place an item on the calendar. */
export const CALENDAR_COLUMN_TYPES = ['date', 'timeline'] as const;

/** The days an item covers: one day for a date column, from..to for a timeline column. */
export interface DaySpan {
  from: string;
  to: string;
  /** `HH:MM` of a date value that has a time. */
  time: string | null;
  /** True for a timeline value (it can span several days). */
  isRange: boolean;
}

/** An item dropped on a new day whose write has not landed yet: the column's new value. */
export type CalendarPatches = Readonly<Record<string, unknown>>;

export interface CalendarSegment {
  /** Unique per week row: `<itemId>@<weekIndex>`. */
  key: string;
  item: ItemDoc;
  name: string;
  /** What the bar says: the name, with the time before it for a timed date. */
  text: string;
  /** Screen-reader name: "Name, Oct 3 to Oct 17". */
  label: string;
  /** The first day this bar covers (where a drag by its start would hold it). */
  startDay: string;
  /** 0-based column of the first day this bar covers in its week row. */
  colStart: number;
  colSpan: number;
  /** Stack row within the week (0 = top). */
  lane: number;
  /** Index of the item in the view's order (sets the order within a day). */
  order: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Fill colour from the group or the status label; `null` = the neutral token. */
  color: string | null;
  /** Text colour class for contrast with `color`. */
  tone: 'dark' | 'light';
}

export interface CalendarWeek {
  days: string[];
  segments: CalendarSegment[];
  /** Every segment covering each day, in item order (feeds "+N more"). */
  perDay: Record<string, CalendarSegment[]>;
  laneCount: number;
}

export interface LegendEntry {
  key: string;
  name: string;
  color: string;
}

export interface CalendarModel {
  weeks: CalendarWeek[];
  title: string;
  legend: LegendEntry[];
  /** Ids of the items shown on screen, in order (the full item view steps through them). */
  visibleIds: string[];
}

/** The column that places items: the saved one if still a date/timeline column, else the first date, else the first timeline. */
export function resolveCalendarColumn(
  columns: readonly ColumnView[],
  columnId: string | null,
): ColumnView | null {
  const usable = columns.filter((c) => c.def.type === 'date' || c.def.type === 'timeline');
  return (
    usable.find((c) => c.def.id === columnId) ??
    usable.find((c) => c.def.type === 'date') ??
    usable.find((c) => c.def.type === 'timeline') ??
    null
  );
}

/** The status columns a calendar can colour by. */
export const statusColumns = (columns: readonly ColumnView[]): ColumnView[] =>
  columns.filter((c) => c.def.type === 'status');

/** The status column that colours the items, when the saved one still exists. */
export function resolveColorColumn(
  columns: readonly ColumnView[],
  colorBy: string | null,
): ColumnView | null {
  return statusColumns(columns).find((c) => c.def.id === colorBy) ?? null;
}

/** The days an item covers in `column`, or `null` when it has no (valid) value there. */
export function itemSpan(item: ItemDoc, column: ColumnView, override?: unknown): DaySpan | null {
  const raw = override !== undefined ? override : item.values[column.def.id];
  if (raw === null || raw === undefined) return null;
  const parsed = columnRegistry.parseValue(column.def.type, raw);
  if (!parsed.success) return null;
  if (column.def.type === 'timeline') {
    const value = parsed.data as TimelineValue;
    return { from: value.from, to: value.to, time: null, isRange: true };
  }
  const value = parsed.data as DateValue;
  return {
    from: value.date,
    to: value.date,
    time: value.time?.slice(0, 5) ?? null,
    isRange: false,
  };
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Black or white text, whichever reads better on `hex` (WCAG relative luminance). */
export function textToneFor(hex: string | null): 'dark' | 'light' {
  if (!hex || !HEX.test(hex)) return 'dark';
  const full = hex.length === 4 ? `#${[1, 2, 3].map((i) => hex[i]! + hex[i]!).join('')}` : hex;
  const channel = (offset: number) => {
    const c = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // White text reaches 4.5:1 up to about this luminance.
  return luminance > 0.18 ? 'dark' : 'light';
}

export interface BuildCalendarInput {
  items: readonly ItemDoc[];
  column: ColumnView;
  /** Every board column (filters and search read all of them). */
  columns: readonly ColumnView[];
  groups: readonly GroupDef[];
  filterState?: BoardFilterState;
  /** Trimmed search term; empty = none. */
  search: string;
  patches?: CalendarPatches;
  settings: Pick<CalendarSettings, 'mode' | 'showWeekends' | 'firstDayOfWeek' | 'colorBy'>;
  /** Any day of the month or week on screen. */
  anchor: string;
}

/** The weeks on screen for `anchor`: a month grid, or the single week containing it. */
export function visibleWeeks(
  anchor: string,
  mode: CalendarSettings['mode'],
  firstDayOfWeek: FirstDayOfWeek,
  showWeekends: boolean,
): string[][] {
  return mode === 'week'
    ? [weekDays(anchor, firstDayOfWeek, showWeekends)]
    : monthGrid(anchor, firstDayOfWeek, showWeekends);
}

/** "October 2026", or "Oct 19 - 25, 2026" for a week. */
export function periodTitle(
  anchor: string,
  mode: CalendarSettings['mode'],
  firstDayOfWeek: FirstDayOfWeek,
): string {
  if (mode === 'month') return monthTitle(anchor);
  const days = weekDays(anchor, firstDayOfWeek, true);
  return rangeTitle(days[0]!, days[days.length - 1]!);
}

/** Move the shown period one month or week back (-1) or forward (1). */
export function shiftAnchor(anchor: string, mode: CalendarSettings['mode'], by: -1 | 1): string {
  return mode === 'week' ? addDays(anchor, 7 * by) : addMonths(anchor, by);
}

export function buildCalendar(input: BuildCalendarInput): CalendarModel {
  const { column, columns, groups, filterState, search, patches, settings, anchor } = input;
  const defs = columns.map((c) => ({
    ...c.def,
    settings: (c.settings as Record<string, unknown>) ?? c.def.settings,
  }));
  const colorColumn = resolveColorColumn(columns, settings.colorBy);
  const groupColor = new Map(groups.map((g) => [g.id, g.color]));
  const needle = search.trim();

  // Items that pass search and filters, in the view's order (positions, or its sort).
  let shown = input.items.filter((item) => {
    if (item.parentItemId !== null && item.parentItemId !== undefined) return false;
    if (needle && !itemMatchesSearch(item, columns, needle)) return false;
    return (
      !filterState ||
      matchesFilter(item, filterState.filterGroup, null, filterState.personIds, defs)
    );
  });
  shown = [...shown].sort(comparePositions);
  if (filterState && filterState.sortConditions.length > 0) {
    shown = sortItems(shown, filterState.sortConditions, defs) as ItemDoc[];
  }

  const placed = shown.flatMap((item, order) => {
    const span = itemSpan(item, column, patches?.[item.id]);
    return span ? [{ item, span, order }] : [];
  });

  const colorOf = (item: ItemDoc): string | null => {
    if (colorColumn) return cardLabel(item, colorColumn)?.color ?? null;
    return groupColor.get(item.groupId) ?? null;
  };

  const visible = new Set<string>();
  const weeks: CalendarWeek[] = visibleWeeks(
    anchor,
    settings.mode,
    settings.firstDayOfWeek,
    settings.showWeekends,
  ).map((days, weekIndex) => {
    const first = days[0]!;
    const last = days[days.length - 1]!;
    const segments: CalendarSegment[] = [];
    for (const { item, span, order } of placed) {
      if (span.to < first || span.from > last) continue;
      // Displayed days the item touches (weekend days may be hidden in the middle of its span).
      const covered = days.filter((d) => d >= span.from && d <= span.to);
      if (covered.length === 0) continue;
      const colStart = days.indexOf(covered[0]!);
      const colEnd = days.indexOf(covered[covered.length - 1]!);
      const color = colorOf(item);
      const range =
        span.from === span.to
          ? fullDateLabel(span.from)
          : `${shortDateLabel(span.from)} to ${shortDateLabel(span.to)}`;
      segments.push({
        key: `${item.id}@${weekIndex}`,
        item,
        name: item.name,
        text: span.time ? `${span.time} ${item.name}` : item.name,
        label: `${item.name}, ${range}`,
        startDay: days[colStart]!,
        colStart,
        colSpan: colEnd - colStart + 1,
        lane: 0,
        order,
        continuesBefore: span.from < days[colStart]!,
        continuesAfter: span.to > days[colEnd]!,
        color,
        tone: textToneFor(color),
      });
      visible.add(item.id);
    }

    // Longer bars first within a start day, then item order.
    segments.sort((a, b) => a.colStart - b.colStart || b.colSpan - a.colSpan || a.order - b.order);
    const laneEnds: number[] = [];
    for (const segment of segments) {
      let lane = laneEnds.findIndex((end) => end < segment.colStart);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = segment.colStart + segment.colSpan - 1;
      segment.lane = lane;
    }

    const perDay: Record<string, CalendarSegment[]> = {};
    days.forEach((day, col) => {
      perDay[day] = segments
        .filter((s) => s.colStart <= col && col < s.colStart + s.colSpan)
        .sort((a, b) => a.order - b.order);
    });
    return { days, segments, perDay, laneCount: laneEnds.length };
  });

  const legend: LegendEntry[] = colorColumn
    ? (colorColumn.settings as StatusSettings).labels
        .filter((l) => l.label.trim() !== '')
        .sort((a, b) => a.index - b.index)
        .map((l) => ({ key: l.id, name: l.label, color: l.color }))
    : [...groups].sort(comparePositions).map((g) => ({ key: g.id, name: g.title, color: g.color }));

  const visibleIds = placed.filter((p) => visible.has(p.item.id)).map((p) => p.item.id);
  return {
    weeks,
    title: periodTitle(anchor, settings.mode, settings.firstDayOfWeek),
    legend,
    visibleIds,
  };
}

/** How many bar rows fit in a day cell of `cellHeight` (the day number and "+N more" take room). */
export function laneCapacity(
  cellHeight: number,
  metrics: { header: number; row: number; more: number },
): number {
  if (!Number.isFinite(cellHeight) || cellHeight <= 0) return 3;
  return Math.max(1, Math.floor((cellHeight - metrics.header - metrics.more) / metrics.row));
}

/** The items a day cell cannot show: those whose bar is below the last lane that fits. */
export function hiddenOnDay(week: CalendarWeek, day: string, capacity: number): CalendarSegment[] {
  return (week.perDay[day] ?? []).filter((s) => s.lane >= capacity);
}

export interface MovePlan {
  /** The column's new value, ready for `tableActions.setCell`. */
  value: DateValue | TimelineValue;
  from: string;
  to: string;
}

/**
 * What dragging an item from `grabDay` and dropping it on `dropDay` writes: a date keeps its time,
 * a timeline moves both ends by the same number of days and keeps its length. `null` when the
 * item has no value in the column or would not move.
 */
export function planMove(
  item: ItemDoc,
  column: ColumnView,
  grabDay: string,
  dropDay: string,
): MovePlan | null {
  const shift = diffDays(grabDay, dropDay);
  if (shift === 0) return null;
  const raw = item.values[column.def.id];
  if (raw === null || raw === undefined) return null;
  const parsed = columnRegistry.parseValue(column.def.type, raw);
  if (!parsed.success) return null;
  if (column.def.type === 'timeline') {
    const value = parsed.data as TimelineValue;
    const next = { from: addDays(value.from, shift), to: addDays(value.to, shift) };
    return { value: next, from: next.from, to: next.to };
  }
  const value = parsed.data as DateValue;
  const date = addDays(value.date, shift);
  return { value: { ...value, date }, from: date, to: date };
}

/** The value a new item gets for a day: a date, or a one-day timeline. */
export function valueForDay(column: ColumnView, day: string): DateValue | TimelineValue {
  return column.def.type === 'timeline' ? { from: day, to: day } : { date: day };
}

/** Stable dnd id of a day cell. */
export const dayDropId = (day: string): string => `day:${day}`;
