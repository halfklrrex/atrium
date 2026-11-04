/**
 * Pure model of the Workload view: one row per person, one cell per day, week or month of the
 * Timeline's axis, each holding how much work that person has then (a count of items, or a sum of
 * a Numbers column spread over the item's working days), measured against a capacity. No React and
 * no Firebase, so it is unit tested and the dashboard's Workload widget can call it per board.
 */
import {
  columnRegistry,
  numericOf,
  type BoardFilterState,
  type NumbersValue,
  type PeopleValue,
  type WorkloadSettings,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';
import { addDays, isWeekend } from '../../lib/date-grid';
import { itemSpan, selectItems } from '../board-date-views/date-view-model';
import type { ColumnView } from '../board-table/table-model';
import {
  ZOOM_DAY_WIDTH,
  axisRange,
  buildAxis,
  resolveTimelineColumn,
  type TimelineAxis,
  type TimelineZoom,
} from '../board-timeline/timeline-model';

export type WorkloadMeasure = WorkloadSettings['measure'];
export type WorkloadLevel = 'empty' | 'under' | 'balanced' | 'over';

/** A cell is under below this share of its capacity, and balanced up to 100%. */
export const UNDER_RATIO = 0.6;
/** Capacity per day when the setting is empty: one item, or eight units of a sum. */
export const DEFAULT_CAPACITY: Record<WorkloadMeasure, number> = { count: 1, sum: 8 };
/** Row key of the "Unassigned" row. */
export const UNASSIGNED_ID = '__unassigned';

const EPSILON = 1e-9;

/** The columns a Workload view reads, as the settings resolve them against the board. */
export interface WorkloadColumns {
  dateColumn: ColumnView | null;
  peopleColumn: ColumnView | null;
  sumColumn: ColumnView | null;
}

/** The saved columns if they still exist and fit, else the first of each kind. */
export function resolveWorkloadColumns(
  columns: readonly ColumnView[],
  settings: Pick<WorkloadSettings, 'columnId' | 'peopleColumnId' | 'sumColumnId'>,
): WorkloadColumns {
  const firstOf = (type: string, id: string | null): ColumnView | null => {
    const usable = columns.filter((c) => c.def.type === type);
    return usable.find((c) => c.def.id === id) ?? usable[0] ?? null;
  };
  return {
    dateColumn: resolveTimelineColumn(columns, settings.columnId),
    peopleColumn: firstOf('people', settings.peopleColumnId),
    sumColumn: firstOf('numbers', settings.sumColumnId),
  };
}

/** Under, balanced or over for `value` against `capacity`; `empty` when there is no work. */
export function levelFor(value: number, capacity: number): WorkloadLevel {
  if (value <= EPSILON) return 'empty';
  if (capacity <= EPSILON) return 'over';
  const ratio = value / capacity;
  if (ratio < UNDER_RATIO - EPSILON) return 'under';
  if (ratio > 1 + EPSILON) return 'over';
  return 'balanced';
}

/** "3", "2.5": up to one decimal, no trailing zero. */
export function formatAmount(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** The people (not teams) in an item's People cell, each once. */
export function personsOf(item: ItemDoc, peopleColumn: ColumnView | null): string[] {
  if (!peopleColumn) return [];
  const raw = item.values[peopleColumn.def.id];
  if (raw === null || raw === undefined) return [];
  const parsed = columnRegistry.parseValue('people', raw);
  if (!parsed.success) return [];
  const ids = (parsed.data as PeopleValue).personsAndTeams
    .filter((p) => p.kind === 'person')
    .map((p) => p.id);
  return [...new Set(ids)];
}

/** An item's number in a Numbers column; missing, invalid and negative values are 0. */
export function amountOf(item: ItemDoc, sumColumn: ColumnView | null): number {
  if (!sumColumn) return 0;
  const raw = item.values[sumColumn.def.id];
  if (raw === null || raw === undefined) return 0;
  const parsed = columnRegistry.parseValue('numbers', raw);
  if (!parsed.success) return 0;
  const n = numericOf(parsed.data as NumbersValue);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The unit text of a Numbers column ("h", " kg"; "$" goes before and is not repeated). */
export function unitOf(sumColumn: ColumnView | null): string {
  if (!sumColumn) return '';
  const settings = columnRegistry.parseSettings('numbers', sumColumn.settings);
  const unit = settings.success
    ? (settings.data as { unit: { symbol: string; direction: string } | null }).unit
    : null;
  return unit && unit.direction === 'right' ? ` ${unit.symbol}` : '';
}

/** One item's share of a cell. */
export interface WorkloadEntry {
  item: ItemDoc;
  /** What the item adds to the cell, in the cell's unit. */
  amount: number;
  /** The item's real first and last day. */
  from: string;
  to: string;
}

export interface WorkloadCell {
  key: string;
  /** The axis label of the period ("Tu 18", "W43 19 - 25", "Oct"). */
  label: string;
  startIdx: number;
  span: number;
  today: boolean;
  /** A day cell on a Saturday or Sunday. */
  weekend: boolean;
  value: number;
  /** Capacity of the person for the cell: per-day capacity times its working days. */
  capacity: number;
  level: WorkloadLevel;
  entries: WorkloadEntry[];
}

export interface WorkloadRow {
  /** The person's uid, or `UNASSIGNED_ID`. */
  id: string;
  name: string;
  cells: WorkloadCell[];
  /** Sum of the cells. */
  total: number;
  /** Distinct items with work in the range. */
  itemCount: number;
  /** At least one cell is over capacity. */
  overCapacity: boolean;
}

export interface BuildWorkloadInput {
  items: readonly ItemDoc[];
  /** Every board column (filters and search read all of them). */
  columns: readonly ColumnView[];
  dateColumn: ColumnView;
  peopleColumn: ColumnView | null;
  /** The Numbers column `sum` adds up; without one the measure falls back to `count`. */
  sumColumn?: ColumnView | null;
  filterState?: BoardFilterState;
  search: string;
  settings: Pick<WorkloadSettings, 'zoom' | 'measure' | 'capacityPerDay' | 'showWeekends'>;
  /** Today as `YYYY-MM-DD`. */
  today: string;
  /** Display name of a person; the id stands in when unknown. */
  nameOf?: (id: string) => string | undefined;
}

export interface WorkloadModel {
  axis: TimelineAxis;
  zoom: TimelineZoom;
  dayWidth: number;
  /** Axis index of today (the first displayed day on or after it). */
  todayIdx: number;
  /** The measure in use (`count` when `sum` has no Numbers column). */
  measure: WorkloadMeasure;
  /** Capacity of one person for one day, as resolved. */
  capacityPerDay: number;
  rows: WorkloadRow[];
  /** Shown items without a date in the column. */
  noDates: ItemDoc[];
  /** No shown item has a date. */
  noItemsDated: boolean;
}

/** A working day for the spread: weekends do not count when they are hidden. */
const isWorkingDay = (day: string, showWeekends: boolean): boolean =>
  showWeekends || !isWeekend(day);

/**
 * Build the grid. An item counts in every working day its span covers, fully for each assignee
 * (teams are skipped; an item with nobody lands in "Unassigned"). With `sum` the item's number is
 * spread evenly over its working days, so a 40 h item over five days adds 8 h a day; with `count`
 * it counts once per day. A week or month cell adds up its days.
 */
export function buildWorkload(input: BuildWorkloadInput): WorkloadModel {
  const { columns, dateColumn, peopleColumn, settings, today } = input;
  const sumColumn = input.sumColumn ?? null;
  const measure: WorkloadMeasure = settings.measure === 'sum' && sumColumn ? 'sum' : 'count';
  const capacityPerDay =
    settings.capacityPerDay !== null && settings.capacityPerDay > 0
      ? settings.capacityPerDay
      : DEFAULT_CAPACITY[measure];
  const nameOf = (id: string) => input.nameOf?.(id) ?? id;

  const shown = selectItems({
    items: input.items,
    columns,
    filterState: input.filterState,
    search: input.search,
  });
  const placed: { item: ItemDoc; from: string; to: string; people: string[] }[] = [];
  const noDates: ItemDoc[] = [];
  const everyone = new Set<string>();
  let hasUnassigned = false;
  for (const item of shown) {
    const people = personsOf(item, peopleColumn);
    if (people.length === 0) hasUnassigned = true;
    for (const id of people) everyone.add(id);
    const span = itemSpan(item, dateColumn);
    if (!span) noDates.push(item);
    else placed.push({ item, from: span.from, to: span.to, people });
  }

  const range = axisRange(placed, settings.zoom, today);
  const axis = buildAxis(range.from, range.to, settings.zoom, settings.showWeekends, today);
  const dayIndex = new Map(axis.days.map((day, i) => [day, i]));
  const cellOfDay: number[] = [];
  axis.cells.forEach((cell, ci) => {
    for (let i = cell.startIdx; i < cell.startIdx + cell.span; i++) cellOfDay[i] = ci;
  });
  const capacityOfCell = axis.cells.map((cell) => {
    let working = 0;
    for (let i = cell.startIdx; i < cell.startIdx + cell.span; i++) {
      if (isWorkingDay(axis.days[i]!, settings.showWeekends)) working += 1;
    }
    return working * capacityPerDay;
  });

  // Per row (person key), per cell: the amount each item adds.
  const loads = new Map<string, Map<number, Map<string, number>>>();
  const itemsById = new Map<string, WorkloadEntry>();
  for (const { item, from, to, people } of placed) {
    const working: string[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (isWorkingDay(day, settings.showWeekends)) working.push(day);
    }
    if (working.length === 0) continue;
    const perDay = measure === 'sum' ? amountOf(item, sumColumn) / working.length : 1;
    itemsById.set(item.id, { item, amount: 0, from, to });
    const keys = people.length > 0 ? people : [UNASSIGNED_ID];
    for (const day of working) {
      const idx = dayIndex.get(day);
      if (idx === undefined) continue;
      const ci = cellOfDay[idx]!;
      for (const key of keys) {
        const rowLoad = loads.get(key) ?? new Map<number, Map<string, number>>();
        loads.set(key, rowLoad);
        const cellLoad = rowLoad.get(ci) ?? new Map<string, number>();
        rowLoad.set(ci, cellLoad);
        cellLoad.set(item.id, (cellLoad.get(item.id) ?? 0) + perDay);
      }
    }
  }

  const rowOf = (id: string, name: string): WorkloadRow => {
    const rowLoad = loads.get(id);
    const distinct = new Set<string>();
    let total = 0;
    let overCapacity = false;
    const cells = axis.cells.map<WorkloadCell>((cell, ci) => {
      const entries: WorkloadEntry[] = [];
      let value = 0;
      for (const [itemId, amount] of rowLoad?.get(ci) ?? []) {
        const base = itemsById.get(itemId)!;
        entries.push({ item: base.item, amount, from: base.from, to: base.to });
        value += amount;
        distinct.add(itemId);
      }
      entries.sort((a, b) => b.amount - a.amount || a.item.name.localeCompare(b.item.name));
      const capacity = capacityOfCell[ci]!;
      const level = levelFor(value, capacity);
      if (level === 'over') overCapacity = true;
      total += value;
      return {
        key: cell.key,
        label: cell.label,
        startIdx: cell.startIdx,
        span: cell.span,
        today: cell.today,
        weekend: settings.zoom === 'days' && isWeekend(axis.days[cell.startIdx]!),
        value,
        capacity,
        level,
        entries,
      };
    });
    return { id, name, cells, total, itemCount: distinct.size, overCapacity };
  };

  const rows = [...everyone]
    .map((id) => ({ id, name: nameOf(id) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((p) => rowOf(p.id, p.name));
  if (hasUnassigned) rows.push(rowOf(UNASSIGNED_ID, 'Unassigned'));

  return {
    axis,
    zoom: settings.zoom,
    dayWidth: ZOOM_DAY_WIDTH[settings.zoom],
    todayIdx: Math.min(axis.lowerBound(today), Math.max(0, axis.days.length - 1)),
    measure,
    capacityPerDay,
    rows,
    noDates,
    noItemsDated: placed.length === 0,
  };
}
