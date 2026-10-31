/**
 * The Chart view's model: which items are charted, how they fall into X buckets (and stack
 * series), what each bucket is worth on the Y axis, in what order and colour, and the text a
 * screen reader gets. Pure: no React and no Firebase. One O(n) pass over the shown items.
 */
import {
  CHART_EMPTY_BUCKET,
  CHART_GROUP_AXIS,
  CHART_LIMITS,
  CHART_OTHER_BUCKET,
  columnRegistry,
  findStatusLabel,
  getWeekDateRange,
  type BoardFilterState,
  type ChartSettings,
  type DropdownSettings,
  type GroupDef,
  type StatusSettings,
  type StatusValue,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';
import { comparePositions } from '../../lib/positions';
import { selectItems, type LegendEntry } from '../board-date-views/date-view-model';
import type { ColumnView } from '../board-table/table-model';

/** Column types that can be the X axis. */
export const CHART_X_TYPES = ['status', 'people', 'dropdown', 'date', 'timeline'] as const;
/** Column types that can split a stacked bar (besides the board groups). */
export const CHART_STACK_TYPES = ['status', 'people', 'dropdown'] as const;

export type DimKind = 'group' | 'status' | 'people' | 'dropdown' | 'date' | 'timeline';
type DateBucket = ChartSettings['dateBucket'];

/** An axis: the board groups, or one column. */
export interface ChartDim {
  /** The column id, or `__group`. */
  id: string;
  title: string;
  kind: DimKind;
  column: ColumnView | null;
}

const GROUP_DIM: ChartDim = { id: CHART_GROUP_AXIS, title: 'Group', kind: 'group', column: null };

const dimOf = (column: ColumnView): ChartDim => ({
  id: column.def.id,
  title: column.def.title,
  kind: column.def.type as DimKind,
  column,
});

const isOneOf = (list: readonly string[], type: string): boolean => list.includes(type);

/** The X axis the settings mean: the saved column when it still fits, else the first status column, else groups. */
export function resolveXDim(columns: readonly ColumnView[], id: string | null): ChartDim {
  if (id === CHART_GROUP_AXIS) return GROUP_DIM;
  const saved = id ? columns.find((c) => c.def.id === id) : undefined;
  if (saved && isOneOf(CHART_X_TYPES, saved.def.type)) return dimOf(saved);
  const status = columns.find((c) => c.def.type === 'status');
  return status ? dimOf(status) : GROUP_DIM;
}

/** The stack split a stacked bar uses (never the X axis), or `null` when nothing else fits. */
export function resolveStackDim(
  columns: readonly ColumnView[],
  id: string | null,
  x: ChartDim,
): ChartDim | null {
  if (id === CHART_GROUP_AXIS && x.id !== CHART_GROUP_AXIS) return GROUP_DIM;
  const saved = id ? columns.find((c) => c.def.id === id) : undefined;
  if (saved && saved.def.id !== x.id && isOneOf(CHART_STACK_TYPES, saved.def.type)) {
    return dimOf(saved);
  }
  const status = columns.find((c) => c.def.type === 'status' && c.def.id !== x.id);
  if (status) return dimOf(status);
  return x.id === CHART_GROUP_AXIS ? null : GROUP_DIM;
}

export interface YAxis {
  mode: ChartSettings['yMode'];
  column: ColumnView | null;
  /** True when the saved mode could not be used and the chart counts items instead. */
  fellBack: boolean;
}

/** The Y measure the settings mean, falling back to a count when the Numbers column is gone. */
export function resolveY(columns: readonly ColumnView[], settings: ChartSettings): YAxis {
  if (settings.yMode === 'count') return { mode: 'count', column: null, fellBack: false };
  const numbers = columns.filter((c) => c.def.type === 'numbers');
  const column = settings.yColumnId
    ? numbers.find((c) => c.def.id === settings.yColumnId)
    : numbers[0];
  return column
    ? { mode: settings.yMode, column, fellBack: false }
    : { mode: 'count', column: null, fellBack: true };
}

// ---- Aggregation ----

interface Acc {
  /** Items (an item with several people counts once for each). */
  count: number;
  /** Items with a number. */
  n: number;
  sum: number;
  min: number;
  max: number;
}

const newAcc = (): Acc => ({ count: 0, n: 0, sum: 0, min: Infinity, max: -Infinity });

function mergeAcc(into: Acc, from: Acc): void {
  into.count += from.count;
  into.n += from.n;
  into.sum += from.sum;
  into.min = Math.min(into.min, from.min);
  into.max = Math.max(into.max, from.max);
}

function accValue(acc: Acc, mode: ChartSettings['yMode']): number | null {
  switch (mode) {
    case 'count':
      return acc.count;
    case 'sum':
      return acc.n > 0 ? acc.sum : 0;
    case 'average':
      return acc.n > 0 ? acc.sum / acc.n : null;
    case 'min':
      return acc.n > 0 ? acc.min : null;
    case 'max':
      return acc.n > 0 ? acc.max : null;
  }
}

// ---- Dates ----

const DAY_MS = 86_400_000;
const parseDay = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function bucketKey(date: string, bucket: DateBucket): string {
  if (bucket === 'day') return date;
  if (bucket === 'week') return getWeekDateRange(date, 'monday').startDate;
  return date.slice(0, 7);
}

function nextKey(key: string, bucket: DateBucket): string {
  if (bucket === 'day') return isoOf(parseDay(key) + DAY_MS);
  if (bucket === 'week') return isoOf(parseDay(key) + 7 * DAY_MS);
  const [year, month] = key.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** How many buckets of `bucket` lie between two dates, inclusive. */
function bucketSpan(min: string, max: string, bucket: DateBucket): number {
  if (bucket === 'month') {
    return (
      (Number(max.slice(0, 4)) - Number(min.slice(0, 4))) * 12 +
      (Number(max.slice(5, 7)) - Number(min.slice(5, 7))) +
      1
    );
  }
  const first = bucket === 'week' ? bucketKey(min, 'week') : min;
  const days = Math.round((parseDay(max) - parseDay(first)) / DAY_MS);
  return Math.floor(days / (bucket === 'week' ? 7 : 1)) + 1;
}

const dateFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
const DAY_FORMAT = dateFormat({ day: 'numeric', month: 'short', year: 'numeric' });
const MONTH_FORMAT = dateFormat({ month: 'short', year: 'numeric' });
const SHORT_DAY_FORMAT = dateFormat({ day: 'numeric', month: 'short' });
const SHORT_YEAR_FORMAT = dateFormat({ day: 'numeric', month: 'short', year: '2-digit' });

function dateLabel(key: string, bucket: DateBucket): string {
  if (bucket === 'month') return MONTH_FORMAT.format(parseDay(`${key}-01`));
  const text = DAY_FORMAT.format(parseDay(key));
  return bucket === 'week' ? `Week of ${text}` : text;
}

/** A day or week label short enough for an axis; the year only when the axis spans several. */
function shortDateLabel(key: string, withYear: boolean): string {
  return (withYear ? SHORT_YEAR_FORMAT : SHORT_DAY_FORMAT).format(parseDay(key));
}

/** The widest-first order a too-long date axis is widened through. */
const WIDER: Record<DateBucket, DateBucket> = { day: 'week', week: 'month', month: 'month' };

// ---- Values read from items ----

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function numberOf(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Reads the raw keys an item falls into on one axis (empty = the item has no value there). */
interface KeyReader {
  dim: ChartDim;
  keys: (item: ItemDoc, bucket: DateBucket) => string[];
  /** Buckets known up front, in their natural order (status labels, groups, dropdown labels). */
  known: { key: string; label: string; color: string | null }[];
  /** Label of a discovered key (people, dates). */
  labelOf: (key: string) => string;
  /** Whether the same item can land in several buckets. */
  multi: boolean;
}

function makeReader(
  dim: ChartDim,
  groups: readonly GroupDef[],
  userName: (uid: string) => string | undefined,
  dateBucketNow: () => DateBucket,
): KeyReader {
  const none = (): KeyReader => ({
    dim,
    keys: () => [],
    known: [],
    labelOf: (k) => k,
    multi: false,
  });
  const id = dim.id;
  switch (dim.kind) {
    case 'group': {
      const sorted = [...groups].sort(comparePositions);
      const ids = new Set(sorted.map((g) => g.id));
      return {
        dim,
        keys: (item) => (ids.has(item.groupId) ? [item.groupId] : []),
        known: sorted.map((g) => ({ key: g.id, label: g.title, color: g.color })),
        labelOf: (k) => k,
        multi: false,
      };
    }
    case 'status': {
      const settings = dim.column?.settings as StatusSettings | undefined;
      if (!settings) return none();
      const labels = settings.labels.filter((l) => l.label.trim() !== '');
      return {
        dim,
        keys: (item) => {
          const raw = item.values[id];
          if (!isRec(raw)) return [];
          const label = findStatusLabel(raw as StatusValue, settings);
          return label && label.label.trim() !== '' ? [label.id] : [];
        },
        known: [...labels]
          .sort((a, b) => a.index - b.index)
          .map((l) => ({ key: l.id, label: l.label, color: l.color })),
        labelOf: (k) => k,
        multi: false,
      };
    }
    case 'dropdown': {
      const settings = dim.column?.settings as DropdownSettings | undefined;
      if (!settings) return none();
      const valid = new Set(settings.labels.map((l) => l.id));
      return {
        dim,
        keys: (item) => {
          const raw = item.values[id];
          if (!isRec(raw) || !Array.isArray(raw.ids)) return [];
          const out = new Set<string>();
          for (const n of raw.ids) if (typeof n === 'number' && valid.has(n)) out.add(String(n));
          return [...out];
        },
        known: settings.labels.map((l) => ({ key: String(l.id), label: l.label, color: null })),
        labelOf: (k) => k,
        multi: true,
      };
    }
    case 'people':
      return {
        dim,
        keys: (item) => {
          const raw = item.values[id];
          if (!isRec(raw) || !Array.isArray(raw.personsAndTeams)) return [];
          const out = new Set<string>();
          for (const p of raw.personsAndTeams) {
            if (isRec(p) && p.kind === 'person' && typeof p.id === 'string') out.add(p.id);
          }
          return [...out];
        },
        known: [],
        labelOf: (k) => userName(k) ?? 'Unknown person',
        multi: true,
      };
    case 'date':
    case 'timeline': {
      const field = dim.kind === 'date' ? 'date' : 'from';
      return {
        dim,
        keys: (item, bucket) => {
          const raw = item.values[id];
          const date = isRec(raw) ? raw[field] : undefined;
          return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
            ? [bucketKey(date, bucket)]
            : [];
        },
        known: [],
        labelOf: (k) => dateLabel(k, dateBucketNow()),
        multi: false,
      };
    }
  }
}

// ---- The model ----

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface ChartSegment {
  seriesKey: string;
  label: string;
  color: string;
  from: number;
  to: number;
  value: number;
  tooltip: string;
}

export interface ChartBucket {
  key: string;
  label: string;
  /** The label under the bar: like `label`, but short for day and week buckets. */
  axisLabel: string;
  color: string;
  /** The Y value; `null` = nothing to plot (no numbers in the bucket). */
  value: number | null;
  text: string;
  /** Items in the bucket. */
  count: number;
  /** Share of the plotted total (0..1), or `null`. */
  share: number | null;
  tooltip: string;
  /** Stacked bar only: the series pieces, bottom up. */
  segments: ChartSegment[];
}

export interface ChartModel {
  chartType: ChartSettings['chartType'];
  title: string;
  xTitle: string;
  xKind: DimKind;
  yLabel: string;
  stackTitle: string | null;
  buckets: ChartBucket[];
  /** Stacked bar: one entry per series. */
  series: ChartSeries[];
  legend: LegendEntry[];
  /** True when the bars/slices take the label (or group) colour of their bucket. */
  coloredBuckets: boolean;
  /** Sum of the plotted values (pie and donut centre). */
  total: number;
  totalText: string;
  formatValue: (n: number) => string;
  /** Items that passed the filters. */
  itemCount: number;
  /** Notes shown under the chart (date widening, truncation). */
  notes: string[];
  /** Set when a saved Y measure was unusable and the chart counts items instead. */
  yFallback: string | null;
  multiValue: boolean;
  ariaLabel: string;
  table: { head: string[]; rows: string[][]; caption: string };
}

export interface ChartModelInput {
  items: readonly ItemDoc[];
  columns: readonly ColumnView[];
  groups: readonly GroupDef[];
  settings: ChartSettings;
  filterState?: BoardFilterState;
  search: string;
  userName: (uid: string) => string | undefined;
}

const TYPE_NAMES: Record<ChartSettings['chartType'], string> = {
  bar: 'Bar chart',
  stacked_bar: 'Stacked bar chart',
  line: 'Line chart',
  pie: 'Pie chart',
  donut: 'Donut chart',
};

const MODE_LABELS: Record<Exclude<ChartSettings['yMode'], 'count'>, string> = {
  sum: 'Sum of',
  average: 'Average of',
  min: 'Min of',
  max: 'Max of',
};

const seriesColor = (index: number): string =>
  `var(--atrium-chart-series-${(index % CHART_LIMITS.series) + 1})`;
const EMPTY_COLOR = 'var(--atrium-chart-empty)';
const OTHER_COLOR = 'var(--atrium-chart-other)';
const MAX_ARIA_BUCKETS = 10;

interface Row {
  key: string;
  label: string;
  color: string | null;
  cells: Map<string, Acc>;
}

const rowValue = (row: Row, mode: ChartSettings['yMode'], stacked: boolean): number | null => {
  if (!stacked) {
    return accValue(row.cells.get('') ?? newAcc(), mode);
  }
  let total = 0;
  let any = false;
  for (const cell of row.cells.values()) {
    const v = accValue(cell, mode);
    if (v !== null) {
      total += v;
      any = true;
    }
  }
  // A bucket with no cells (a gap between dates) is 0 for a count or a sum, nothing otherwise.
  return any || mode === 'count' || mode === 'sum' ? total : null;
};

function mergeRows(rows: readonly Row[], key: string, label: string): Row {
  const merged: Row = { key, label, color: null, cells: new Map() };
  for (const row of rows) {
    for (const [sKey, acc] of row.cells) {
      let into = merged.cells.get(sKey);
      if (!into) merged.cells.set(sKey, (into = newAcc()));
      mergeAcc(into, acc);
    }
  }
  return merged;
}

/** Builds everything the chart draws from the board's items and the view's settings. */
export function buildChartModel(input: ChartModelInput): ChartModel {
  const { columns, groups, settings, userName } = input;
  const items = selectItems({
    items: input.items,
    columns,
    filterState: input.filterState,
    search: input.search,
  });
  const xDim = resolveXDim(columns, settings.xColumnId);
  const stacked = settings.chartType === 'stacked_bar';
  const stackDim = stacked ? resolveStackDim(columns, settings.stackColumnId, xDim) : null;
  const y = resolveY(columns, settings);
  const isDate = xDim.kind === 'date' || xDim.kind === 'timeline';
  const notes: string[] = [];

  // ---- Date granularity: widen day -> week -> month until the axis fits.
  let bucket: DateBucket = settings.dateBucket;
  let dateNote: string | null = null;
  let dateMin = '';
  let dateMax = '';
  if (isDate) {
    const probe = makeReader(xDim, groups, userName, () => bucket);
    for (const item of items) {
      const [k] = probe.keys(item, 'day');
      if (k === undefined) continue;
      if (dateMin === '' || k < dateMin) dateMin = k;
      if (k > dateMax) dateMax = k;
    }
    if (dateMin !== '') {
      while (
        bucketSpan(dateMin, dateMax, bucket) > CHART_LIMITS.xBuckets &&
        WIDER[bucket] !== bucket
      ) {
        bucket = WIDER[bucket];
      }
      if (bucket !== settings.dateBucket) {
        dateNote = `Showing ${bucket === 'week' ? 'weeks' : 'months'} so the chart fits ${CHART_LIMITS.xBuckets} columns.`;
      }
    }
  }

  const xReader = makeReader(xDim, groups, userName, () => bucket);
  const sReader = stackDim ? makeReader(stackDim, groups, userName, () => bucket) : null;
  const yId = y.column?.def.id;

  // ---- One pass: item -> (x key, stack key) cells.
  const rows = new Map<string, Row>();
  const seriesTotals = new Map<string, number>();
  const seen = new Set<string>();
  for (const item of items) {
    const xs = xReader.keys(item, bucket);
    const xKeys = xs.length > 0 ? xs : [CHART_EMPTY_BUCKET];
    const ss = sReader ? sReader.keys(item, bucket) : [];
    const sKeys = sReader ? (ss.length > 0 ? ss : [CHART_EMPTY_BUCKET]) : [''];
    const number = yId ? numberOf(item.values[yId]) : null;
    for (const xKey of xKeys) {
      let row = rows.get(xKey);
      if (!row) {
        row = { key: xKey, label: '', color: null, cells: new Map() };
        rows.set(xKey, row);
      }
      for (const sKey of sKeys) {
        let acc = row.cells.get(sKey);
        if (!acc) row.cells.set(sKey, (acc = newAcc()));
        acc.count += 1;
        if (number !== null) {
          acc.n += 1;
          acc.sum += number;
          if (number < acc.min) acc.min = number;
          if (number > acc.max) acc.max = number;
        }
        seen.add(sKey);
      }
    }
  }

  // ---- Value formatting.
  const numbersSettings = y.column?.settings;
  const formatValue = (n: number): string => {
    if (!y.column) return n.toLocaleString('en-US');
    const rounded = y.mode === 'average' ? Math.round(n * 100) / 100 : n;
    return columnRegistry.toText('numbers', rounded, numbersSettings);
  };

  // ---- Known + discovered buckets, in order.
  const knownIndex = new Map(xReader.known.map((k, i) => [k.key, i]));
  const keysPresent = [...rows.keys()].filter((k) => k !== CHART_EMPTY_BUCKET);
  let order: string[];
  if (isDate) {
    order = keysPresent.sort();
    if (order.length > 0) {
      const filled: string[] = [];
      for (
        let k = order[0]!;
        k <= order[order.length - 1]! && filled.length < 5000;
        k = nextKey(k, bucket)
      ) {
        filled.push(k);
      }
      order = filled;
      if (order.length > CHART_LIMITS.xBuckets) {
        order = order.slice(-CHART_LIMITS.xBuckets);
        dateNote = `Showing the latest ${CHART_LIMITS.xBuckets} months.`;
      }
    }
  } else if (xReader.known.length > 0) {
    order = keysPresent.sort((a, b) => (knownIndex.get(a) ?? 0) - (knownIndex.get(b) ?? 0));
  } else {
    order = keysPresent.sort((a, b) =>
      xReader.labelOf(a).localeCompare(xReader.labelOf(b), undefined, { sensitivity: 'base' }),
    );
  }
  if (dateNote) notes.push(dateNote);

  const labelFor = (reader: KeyReader, key: string): string => {
    if (key === CHART_EMPTY_BUCKET) return 'Empty';
    const known = reader.known.find((k) => k.key === key);
    return known ? known.label : reader.labelOf(key);
  };
  const colorFor = (reader: KeyReader, key: string): string | null =>
    reader.known.find((k) => k.key === key)?.color ?? null;

  let regular: Row[] = order.map((key) => {
    const row = rows.get(key) ?? { key, label: '', color: null, cells: new Map() };
    return { ...row, label: labelFor(xReader, key), color: colorFor(xReader, key) };
  });
  const emptyRow = rows.get(CHART_EMPTY_BUCKET);

  // ---- Sort (dates stay in time order).
  const mode = y.mode;
  const valueOf = (row: Row) => rowValue(row, mode, stacked);
  if (!isDate && settings.sortBy !== 'board') {
    const dir = settings.sortBy === 'value_desc' ? -1 : 1;
    regular = [...regular].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return dir * (av - bv);
    });
  }

  // ---- Cap: merge the smallest into "Other".
  const pieLike = settings.chartType === 'pie' || settings.chartType === 'donut';
  const showEmpty = settings.showEmpty && emptyRow !== undefined;
  const cap = (pieLike ? CHART_LIMITS.slices : CHART_LIMITS.xBuckets) - (showEmpty ? 1 : 0);
  let otherRow: Row | null = null;
  if (!isDate && regular.length > cap) {
    const ranked = [...regular].sort(
      (a, b) => Math.abs(valueOf(b) ?? 0) - Math.abs(valueOf(a) ?? 0),
    );
    const keep = new Set(ranked.slice(0, cap - 1).map((r) => r.key));
    otherRow = mergeRows(
      regular.filter((r) => !keep.has(r.key)),
      CHART_OTHER_BUCKET,
      'Other',
    );
    regular = regular.filter((r) => keep.has(r.key));
    notes.push(`The smallest ${order.length - regular.length} are grouped as Other.`);
  }
  const final: Row[] = [...regular];
  if (otherRow) final.push(otherRow);
  if (showEmpty && emptyRow) final.push({ ...emptyRow, label: 'Empty', color: null });

  // ---- Series (stacked bar).
  let series: ChartSeries[] = [];
  if (stacked && sReader) {
    const present = [...seen];
    for (const row of final) {
      for (const [sKey, acc] of row.cells) {
        seriesTotals.set(sKey, (seriesTotals.get(sKey) ?? 0) + (accValue(acc, mode) ?? 0));
      }
    }
    const sKnown = new Map(sReader.known.map((k, i) => [k.key, i]));
    let sKeys = present.filter((k) => k !== CHART_EMPTY_BUCKET);
    sKeys = sReader.known.length
      ? sKeys.sort((a, b) => (sKnown.get(a) ?? 0) - (sKnown.get(b) ?? 0))
      : sKeys.sort((a, b) =>
          sReader.labelOf(a).localeCompare(sReader.labelOf(b), undefined, { sensitivity: 'base' }),
        );
    const hasEmptySeries = present.includes(CHART_EMPTY_BUCKET) && settings.showEmpty;
    const sCap = CHART_LIMITS.series - (hasEmptySeries ? 1 : 0);
    let overflow = new Set<string>();
    if (sKeys.length > sCap) {
      const ranked = [...sKeys].sort(
        (a, b) => Math.abs(seriesTotals.get(b) ?? 0) - Math.abs(seriesTotals.get(a) ?? 0),
      );
      overflow = new Set(ranked.slice(sCap - 1));
      sKeys = sKeys.filter((k) => !overflow.has(k));
      notes.push(`The smallest ${overflow.size} stacks are grouped as Other.`);
    }
    series = sKeys.map((key, i) => ({
      key,
      label: labelFor(sReader, key),
      color: colorFor(sReader, key) ?? seriesColor(i),
    }));
    if (overflow.size > 0)
      series.push({ key: CHART_OTHER_BUCKET, label: 'Other', color: OTHER_COLOR });
    if (hasEmptySeries)
      series.push({ key: CHART_EMPTY_BUCKET, label: 'Empty', color: EMPTY_COLOR });
    if (overflow.size > 0 || !settings.showEmpty) {
      for (const row of final) {
        const merged = new Map<string, Acc>();
        for (const [sKey, acc] of row.cells) {
          if (sKey === CHART_EMPTY_BUCKET && !settings.showEmpty) continue;
          const target = overflow.has(sKey) ? CHART_OTHER_BUCKET : sKey;
          let into = merged.get(target);
          if (!into) merged.set(target, (into = newAcc()));
          mergeAcc(into, acc);
        }
        row.cells = merged;
      }
    }
  }

  // ---- Colours and numbers per bucket.
  const coloredBuckets = xDim.kind === 'status' || xDim.kind === 'group';
  let cycle = 0;
  const yName =
    y.column && y.mode !== 'count' ? `${MODE_LABELS[y.mode]} ${y.column.def.title}` : 'Items';
  const values = final.map((row) => rowValue(row, mode, stacked));
  const plotted = values.reduce<number>((sum, v) => (v !== null && v > 0 ? sum + v : sum), 0);
  const showPercent = mode === 'count' || (mode === 'sum' && pieLike);
  const countText = (n: number): string =>
    `${n.toLocaleString('en-US')} ${n === 1 ? 'item' : 'items'}`;
  const valueText = (v: number | null): string => (v === null ? '–' : formatValue(v));

  const multiYearAxis =
    isDate &&
    final.length > 0 &&
    final[0]!.key.slice(0, 4) !==
      (final
        .filter((r) => /^\d/.test(r.key))
        .at(-1)
        ?.key.slice(0, 4) ?? '');
  const buckets: ChartBucket[] = final.map((row, i) => {
    const value = values[i] ?? null;
    const count = [...row.cells.values()].reduce((sum, c) => sum + c.count, 0);
    const color =
      row.key === CHART_EMPTY_BUCKET
        ? EMPTY_COLOR
        : row.key === CHART_OTHER_BUCKET
          ? OTHER_COLOR
          : (row.color ?? seriesColor(cycle++));
    const share = value !== null && value > 0 && plotted > 0 ? value / plotted : null;
    const pct = showPercent && share !== null ? ` · ${Math.round(share * 100)}%` : '';
    const measure = mode === 'count' ? countText(count) : valueText(value);
    const tooltip =
      mode === 'count'
        ? `${row.label} · ${measure}${pct}`
        : `${xDim.title}: ${row.label} · ${measure}${pct}`;
    const segments: ChartSegment[] = [];
    if (stacked) {
      let up = 0;
      let down = 0;
      for (const s of series) {
        const acc = row.cells.get(s.key);
        const v = acc ? accValue(acc, mode) : null;
        if (v === null || v === 0) continue;
        const from = v > 0 ? up : down;
        const to = from + v;
        if (v > 0) up = to;
        else down = to;
        segments.push({
          seriesKey: s.key,
          label: s.label,
          color: s.color,
          from,
          to,
          value: v,
          tooltip: `${row.label} · ${s.label} · ${mode === 'count' ? countText(acc?.count ?? 0) : valueText(v)}`,
        });
      }
    }
    return {
      key: row.key,
      label: row.label,
      axisLabel:
        isDate && bucket !== 'month' && /^\d{4}-\d{2}-\d{2}$/.test(row.key)
          ? shortDateLabel(row.key, multiYearAxis)
          : row.label,
      color,
      value,
      text: valueText(value),
      count,
      share,
      tooltip,
      segments,
    };
  });

  // ---- Legend: stacked series, pie/donut slices, bars that have colours.
  const legend: LegendEntry[] = stacked
    ? series.map((s) => ({ key: s.key, name: s.label, color: s.color }))
    : pieLike || (settings.chartType === 'bar' && coloredBuckets)
      ? buckets
          .filter((b) => !pieLike || (b.value !== null && b.value > 0))
          .map((b) => ({ key: b.key, name: b.label, color: b.color }))
      : [];

  // ---- Title, aria, hidden table.
  const stackTitle = stackDim ? stackDim.title : null;
  const title = `${yName} by ${xDim.title}${stackTitle ? ` and ${stackTitle}` : ''}`;
  const multiValue = xReader.multi || (sReader?.multi ?? false);
  const listed = buckets
    .slice(0, MAX_ARIA_BUCKETS)
    .map((b) => `${b.label} ${mode === 'count' ? b.count : valueText(b.value)}`)
    .join(', ');
  const more =
    buckets.length > MAX_ARIA_BUCKETS ? `, and ${buckets.length - MAX_ARIA_BUCKETS} more` : '';
  const ariaLabel =
    buckets.length === 0
      ? `${TYPE_NAMES[settings.chartType]}, ${lowerFirst(title)}: no data`
      : `${TYPE_NAMES[settings.chartType]}, ${lowerFirst(title)}: ${listed}${more}`;

  const cellText = (acc: Acc | undefined): string =>
    acc ? (mode === 'count' ? String(acc.count) : valueText(accValue(acc, mode))) : '';
  const head = stacked
    ? [xDim.title, ...series.map((s) => s.label), 'Total']
    : [xDim.title, yName, ...(pieLike ? ['Share'] : [])];
  const tableRows = buckets.map((b, i) => {
    const row = final[i]!;
    return stacked
      ? [b.label, ...series.map((s) => cellText(row.cells.get(s.key))), b.text]
      : [
          b.label,
          mode === 'count' ? String(b.count) : b.text,
          ...(pieLike ? [b.share === null ? '–' : `${Math.round(b.share * 100)}%`] : []),
        ];
  });
  const caption = `${title}.${multiValue ? ' An item with several values counts in each of them, so shares are over the bucket total, not the item count.' : ''}`;

  return {
    chartType: settings.chartType,
    title,
    xTitle: xDim.title,
    xKind: xDim.kind,
    yLabel: yName,
    stackTitle,
    buckets,
    series,
    legend,
    coloredBuckets,
    total: plotted,
    totalText: mode === 'count' ? plotted.toLocaleString('en-US') : formatValue(plotted),
    formatValue,
    itemCount: items.length,
    notes,
    yFallback: y.fellBack ? 'No Numbers column to measure, so the chart counts items.' : null,
    multiValue,
    ariaLabel,
    table: { head, rows: tableRows, caption },
  };
}

const lowerFirst = (s: string): string => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
