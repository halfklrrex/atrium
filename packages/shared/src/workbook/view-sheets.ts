/**
 * The view sheets of the board workbook (spec `P6-export-workbook.md`, "View sheets"): Kanban,
 * Calendar, Timeline, Gantt, Chart and Workload. Each takes plain data the web app computes with
 * the view's own model and lays it out with the workbook's look. Pure: no DOM, no Firebase.
 */
import type { BoardWorkbookData } from './board-workbook';
import { SERIES_COLORS, type ChartSpec } from './chart';
import { Look, ROW_H, header, medium, subtitleText, thin } from './look';
import { PALETTE, textOn } from './palette';
import { SheetWriter } from './sheet';
import type { BorderSide, StyleSpec } from './styles';
import { absRange, quoteSheet } from './xml';

// ---- Data ----

export interface KanbanCard {
  name: string;
  groupColor: string | null;
  /** One line per card column, "Owner: Avery Quinn" (empty values are left out). */
  lines: string[];
}

export interface KanbanViewData {
  type: 'kanban';
  /** The view's name. */
  name: string;
  /** The status column that makes the lanes. */
  columnTitle: string;
  /** Titles of the columns the cards show. */
  cardColumns: string[];
  lanes: { title: string; color: string | null; total: number; cards: KanbanCard[] }[];
}

export interface CalendarEntry {
  name: string;
  color: string | null;
}

export interface CalendarViewData {
  type: 'calendar';
  name: string;
  columnTitle: string;
  firstDayOfWeek: 'monday' | 'sunday';
  /** `YYYY-MM-DD`. */
  today: string;
  /** Months to draw, `YYYY-MM`, in order (at most 24). */
  months: string[];
  /** The items on each day (`YYYY-MM-DD`), in the view's order. */
  entries: Record<string, CalendarEntry[]>;
  note: string | null;
}

export type TimelineRow =
  | { kind: 'group'; title: string; color: string | null }
  | {
      kind: 'item';
      name: string;
      from: string;
      to: string;
      color: string | null;
      groupColor: string | null;
      /** Gantt: the names of the prerequisites. */
      dependsOn?: string;
      /** Gantt: on the critical path. */
      critical?: boolean;
    };

export interface TimelineViewData {
  type: 'timeline' | 'gantt';
  name: string;
  columnTitle: string;
  today: string;
  rows: TimelineRow[];
  note: string | null;
}

export interface ChartViewData {
  type: 'chart';
  name: string;
  chartType: 'bar' | 'stacked_bar' | 'line' | 'pie' | 'donut';
  title: string;
  xTitle: string;
  yLabel: string;
  buckets: { label: string; color: string | null; value: number | null }[];
  /** Stacked bar: the series and each bucket's value per series. */
  series: { label: string; color: string }[];
  stacked: number[][];
  notes: string[];
  showLegend: boolean;
  showValues: boolean;
}

export type WorkloadLevelName = 'empty' | 'under' | 'balanced' | 'over';

export interface WorkloadViewData {
  type: 'workload';
  name: string;
  peopleTitle: string;
  /** "Items" or "Sum of Hours". */
  measureLabel: string;
  periods: { label: string; today: boolean }[];
  rows: { name: string; values: number[]; levels: WorkloadLevelName[]; total: number }[];
  note: string | null;
}

export type ViewSheetData =
  KanbanViewData | CalendarViewData | TimelineViewData | ChartViewData | WorkloadViewData;

/** Sheet names, in workbook order. */
export const VIEW_SHEET_NAMES: Record<ViewSheetData['type'], string> = {
  kanban: 'Kanban',
  calendar: 'Calendar',
  timeline: 'Timeline',
  gantt: 'Gantt',
  chart: 'Chart',
  workload: 'Workload',
};

export const VIEW_SHEET_ORDER: readonly ViewSheetData['type'][] = [
  'kanban',
  'calendar',
  'timeline',
  'gantt',
  'chart',
  'workload',
];

/** One line for the Summary's "In this workbook" list. */
export function viewSheetDescription(view: ViewSheetData): string {
  switch (view.type) {
    case 'kanban':
      return `"${view.name}": a lane per ${view.columnTitle} label with its cards`;
    case 'calendar':
      return `"${view.name}": month grids by ${view.columnTitle}`;
    case 'timeline':
      return `"${view.name}": a bar per item on a day or week grid`;
    case 'gantt':
      return `"${view.name}": bars, dependencies and the critical path`;
    case 'chart':
      return `"${view.name}": the chart's data and a native chart`;
    case 'workload':
      return `"${view.name}": ${view.measureLabel.toLowerCase()} per person and period`;
  }
}

/** Workload cell colours: `--atrium-workload-under/balanced/over` (light theme). */
const WORKLOAD_FILL: Record<WorkloadLevelName, string | null> = {
  empty: null,
  under: '#CCE5FF',
  balanced: '#C4F0D9',
  over: '#FFB3BF',
};

// ---- Dates ----

const DAY_MS = 86_400_000;
const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, n: number): string => isoOf(dayMs(iso) + n * DAY_MS);
const daysBetween = (a: string, b: string): number => Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
const weekday = (iso: string): number => new Date(dayMs(iso)).getUTCDay();
const serial = (iso: string): number => (dayMs(iso) - Date.UTC(1899, 11, 30)) / DAY_MS;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthLabel = (iso: string, short = false): string => {
  const name = MONTHS[Number(iso.slice(5, 7)) - 1] as string;
  return `${short ? name.slice(0, 3) : name} ${iso.slice(0, 4)}`;
};

/** The start of the week holding `iso`. */
function weekStart(iso: string, first: 'monday' | 'sunday'): string {
  const offset = (weekday(iso) - (first === 'monday' ? 1 : 0) + 7) % 7;
  return addDays(iso, -offset);
}

// ---- Common ----

function newSheet(name: string, freeze?: { cols: number; rows: number }): SheetWriter {
  return new SheetWriter(name, {
    tabColor: PALETTE.purple,
    showGridLines: false,
    freeze,
    landscape: true,
    fitToWidth: true,
  });
}

function noteRow(
  sheet: SheetWriter,
  look: Look,
  row: number,
  c1: number,
  c2: number,
  text: string,
) {
  sheet.setHeight(row, 20);
  sheet.text(c1, row, text, look.note);
  if (c2 > c1) sheet.merge({ c1, r1: row, c2, r2: row }, look.note);
}

// ---- Kanban ----

/** Most cards a lane lists; the rest are counted ("and 12 more"). */
export const KANBAN_SHEET_CARDS = 200;

function kanbanSheet(look: Look, data: BoardWorkbookData, view: KanbanViewData): SheetWriter {
  const lanes = view.lanes;
  const last = Math.max(2, lanes.length * 2);
  const sheet = newSheet(VIEW_SHEET_NAMES.kanban, { cols: 0, rows: 7 });
  sheet.setWidth(0, 2);
  lanes.forEach((_, i) => {
    sheet.setWidth(1 + i * 2, 30);
    sheet.setWidth(2 + i * 2, 2);
  });
  header(sheet, look, data, last, subtitleText(data, `Kanban: ${view.name}`), true);
  sheet.setHeight(4, 8);
  const shows =
    view.cardColumns.length > 0
      ? ` Cards show ${view.cardColumns.join(', ')}.`
      : ' Cards show the name.';
  noteRow(sheet, look, 5, 1, last - 1, `Lanes by ${view.columnTitle}.${shows}`);
  sheet.setHeight(6, 8);
  if (lanes.length === 0) {
    noteRow(
      sheet,
      look,
      7,
      1,
      last - 1,
      'This board has no status column, so the view has no lanes.',
    );
    return sheet;
  }

  sheet.setHeight(7, 28);
  lanes.forEach((lane, i) => {
    const fill = lane.color ?? PALETTE.empty;
    const style = look.st.style({
      font: { bold: true, size: 11, color: textOn(fill) },
      fill,
      align: { h: 'left', v: 'center', indent: 1 },
    });
    sheet.text(1 + i * 2, 7, `${lane.title}  ·  ${lane.total}`, style);
  });
  sheet.setHeight(8, 6);

  const lines = view.cardColumns.length;
  const slot = 1 + lines + 1;
  const frame: BorderSide = thin(PALETTE.frame);
  const cardStyle = (groupColor: string | null, part: 'name' | 'line', isLast: boolean) =>
    look.st.style({
      font: part === 'name' ? { bold: true } : { size: 9, color: PALETTE.textMuted },
      fill: PALETTE.band,
      border: {
        left: { style: 'thick', color: groupColor ?? PALETTE.empty },
        right: frame,
        top: part === 'name' ? frame : undefined,
        bottom: isLast ? frame : undefined,
      },
      align: { h: 'left', v: 'center', indent: 1, wrap: part === 'name' },
    });
  const most = Math.max(...lanes.map((l) => l.cards.length));
  let row = 9;
  for (let k = 0; k < most; k += 1) {
    sheet.setHeight(row, 22);
    for (let j = 1; j <= lines; j += 1) sheet.setHeight(row + j, 16);
    sheet.setHeight(row + lines + 1, 6);
    lanes.forEach((lane, i) => {
      const card = lane.cards[k];
      if (!card) return;
      const col = 1 + i * 2;
      sheet.text(col, row, card.name, cardStyle(card.groupColor, 'name', lines === 0));
      for (let j = 0; j < lines; j += 1) {
        sheet.text(
          col,
          row + 1 + j,
          card.lines[j] ?? '',
          cardStyle(card.groupColor, 'line', j === lines - 1),
        );
      }
    });
    row += slot;
  }
  let moreRow = false;
  lanes.forEach((lane, i) => {
    if (lane.total > lane.cards.length) {
      sheet.text(1 + i * 2, row, `and ${lane.total - lane.cards.length} more`, look.note);
      moreRow = true;
    }
  });
  if (moreRow) sheet.setHeight(row, 20);
  return sheet;
}

// ---- Calendar ----

/** Item lines a day shows before "+N more". */
export const CALENDAR_DAY_LINES = 6;
export const CALENDAR_SHEET_MONTHS = 24;

function calendarSheet(look: Look, data: BoardWorkbookData, view: CalendarViewData): SheetWriter {
  const sheet = newSheet(VIEW_SHEET_NAMES.calendar);
  const last = 8;
  sheet.setWidth(0, 2);
  for (let c = 1; c <= 7; c += 1) sheet.setWidth(c, 20);
  sheet.setWidth(8, 2);
  header(sheet, look, data, last, subtitleText(data, `Calendar: ${view.name}`), true);
  sheet.setHeight(4, 8);
  noteRow(
    sheet,
    look,
    5,
    1,
    7,
    `Items by ${view.columnTitle}, coloured like the view.${view.note ? ` ${view.note}` : ''}`,
  );
  const side = thin(PALETTE.rule);
  const dayStyle = (inMonth: boolean, today: boolean) =>
    look.st.style({
      font: {
        bold: today || inMonth,
        size: 9,
        color: today ? PALETTE.white : inMonth ? PALETTE.text : PALETTE.empty,
      },
      fill: today ? PALETTE.brand : inMonth ? undefined : PALETTE.band,
      border: { left: side, right: side, top: thin(PALETTE.frame) },
      align: { h: 'right', v: 'center', indent: 1 },
    });
  const blankStyle = (inMonth: boolean) =>
    look.st.style({
      fill: inMonth ? undefined : PALETTE.band,
      border: { left: side, right: side },
    });
  const pill = (color: string | null) => {
    const fill = color ?? PALETTE.bar;
    return look.st.style({
      font: { size: 9, color: textOn(fill) },
      fill,
      border: { left: side, right: side, bottom: thin(PALETTE.white) },
      align: { h: 'left', v: 'center', indent: 1 },
    });
  };
  const more = look.st.style({
    font: { size: 9, italic: true, color: PALETTE.textMuted },
    border: { left: side, right: side },
    align: { h: 'left', v: 'center', indent: 1 },
  });
  const weekdayHead = look.st.style({
    font: { bold: true, size: 9 },
    fill: PALETTE.brandTint,
    border: { bottom: thin(PALETTE.brand) },
    align: { h: 'center', v: 'center' },
  });

  let row = 7;
  if (view.months.length === 0) {
    noteRow(sheet, look, row, 1, 7, `No item has a ${view.columnTitle} value.`);
    return sheet;
  }
  const firstWeekday = view.firstDayOfWeek === 'monday' ? 1 : 0;
  for (const month of view.months) {
    const first = `${month}-01`;
    const nextMonth = addDays(first, 32).slice(0, 7);
    const lastDay = addDays(`${nextMonth}-01`, -1);
    sheet.setHeight(row, 26);
    sheet.text(1, row, monthLabel(first).toUpperCase(), look.section);
    sheet.merge({ c1: 1, r1: row, c2: 7, r2: row }, look.section);
    row += 1;
    sheet.setHeight(row, 20);
    for (let d = 0; d < 7; d += 1) {
      sheet.text(1 + d, row, WEEKDAYS[(firstWeekday + d) % 7] as string, weekdayHead);
    }
    row += 1;
    for (
      let start = weekStart(first, view.firstDayOfWeek);
      start <= lastDay;
      start = addDays(start, 7)
    ) {
      const days = Array.from({ length: 7 }, (_, d) => addDays(start, d));
      const inMonth = days.map((d) => d.slice(0, 7) === month);
      const counts = days.map((d, i) => (inMonth[i] ? (view.entries[d]?.length ?? 0) : 0));
      const lines = Math.min(CALENDAR_DAY_LINES, Math.max(1, ...counts));
      sheet.setHeight(row, 18);
      days.forEach((d, i) => {
        sheet.text(
          1 + i,
          row,
          String(Number(d.slice(8, 10))),
          dayStyle(inMonth[i] as boolean, d === view.today),
        );
      });
      for (let j = 0; j < lines; j += 1) {
        const r = row + 1 + j;
        sheet.setHeight(r, 17);
        days.forEach((d, i) => {
          const list = inMonth[i] ? (view.entries[d] ?? []) : [];
          const overflow = list.length > lines && j === lines - 1;
          const entry = list[j];
          if (overflow) sheet.text(1 + i, r, `+${list.length - j} more`, more);
          else if (entry) sheet.text(1 + i, r, entry.name, pill(entry.color));
          else sheet.blank(1 + i, r, blankStyle(inMonth[i] as boolean));
        });
      }
      row += 1 + lines;
    }
    // Close the grid with a bottom rule.
    for (let c = 1; c <= 7; c += 1)
      sheet.blank(c, row, look.st.style({ border: { top: thin(PALETTE.frame) } }));
    sheet.setHeight(row, 14);
    row += 1;
  }
  return sheet;
}

// ---- Timeline and Gantt ----

/** Most items a Timeline or Gantt sheet draws (the web caps; the note says so). */
export const TIMELINE_SHEET_ITEMS = 500;
/** Up to this many days the grid has a column per day, else one per week. */
export const TIMELINE_DAY_ZOOM_MAX = 120;
export const TIMELINE_MAX_DAY_COLUMNS = 366;
export const TIMELINE_MAX_WEEK_COLUMNS = 260;

function timelineSheet(look: Look, data: BoardWorkbookData, view: TimelineViewData): SheetWriter {
  const gantt = view.type === 'gantt';
  const items = view.rows.filter(
    (r): r is Extract<TimelineRow, { kind: 'item' }> => r.kind === 'item',
  );
  const left = gantt ? 7 : 5; // marker, Item, Start, End, Days (+ Depends on, Critical)
  const sheet = newSheet(VIEW_SHEET_NAMES[view.type], { cols: left, rows: 6 });
  const notes: string[] = [];
  if (view.note) notes.push(view.note);

  let from = items.reduce((m, r) => (r.from < m ? r.from : m), items[0]?.from ?? view.today);
  let to = items.reduce((m, r) => (r.to > m ? r.to : m), items[0]?.to ?? view.today);
  if (from > to) [from, to] = [to, from];
  const span = daysBetween(from, to) + 1;
  const weekly = span > TIMELINE_DAY_ZOOM_MAX;
  const firstDay = weekly ? weekStart(from, 'monday') : from;
  let count = weekly ? Math.ceil((daysBetween(firstDay, to) + 1) / 7) : span;
  const cap = weekly ? TIMELINE_MAX_WEEK_COLUMNS : TIMELINE_MAX_DAY_COLUMNS;
  if (count > cap) {
    count = cap;
    notes.push(`The grid stops after ${cap} ${weekly ? 'weeks' : 'days'}.`);
  }
  const colStart = (i: number) => addDays(firstDay, weekly ? i * 7 : i);
  const colEnd = (i: number) => addDays(firstDay, weekly ? i * 7 + 6 : i);
  const grid0 = left;
  const last = grid0 + Math.max(count, 1) - 1;

  sheet.setWidth(0, 1.3);
  sheet.setWidth(1, 32);
  sheet.setWidth(2, 11);
  sheet.setWidth(3, 11);
  sheet.setWidth(4, 6);
  if (gantt) {
    sheet.setWidth(5, 24);
    sheet.setWidth(6, 9);
  }
  for (let i = 0; i < count; i += 1) sheet.setWidth(grid0 + i, weekly ? 6 : 3.3);

  header(
    sheet,
    look,
    data,
    last,
    subtitleText(data, `${VIEW_SHEET_NAMES[view.type]}: ${view.name}`),
    true,
  );
  const scale = weekly ? 'one column per week' : 'one column per day';
  noteRow(
    sheet,
    look,
    4,
    1,
    Math.min(last, left + 30),
    [`Bars by ${view.columnTitle}, ${scale}; today in red.`, ...notes].join(' '),
  );

  // Month header (row 5) and column header (row 6).
  const th = look.th;
  const thCenter = look.st.style({
    font: { bold: true, size: 8 },
    fill: PALETTE.brandTint,
    border: { bottom: thin(PALETTE.brand) },
    align: { h: 'center', v: 'center' },
  });
  const thToday = look.st.style({
    font: { bold: true, size: 8, color: PALETTE.white },
    fill: PALETTE.stuck,
    border: { bottom: thin(PALETTE.brand) },
    align: { h: 'center', v: 'center' },
  });
  const monthHead = look.st.style({
    font: { bold: true, size: 9, color: PALETTE.brand },
    border: { left: thin(PALETTE.frame) },
    align: { h: 'left', v: 'center', indent: 1 },
  });
  sheet.setHeight(5, 18);
  sheet.setHeight(6, 24);
  let i0 = 0;
  while (i0 < count) {
    const key = colStart(i0).slice(0, 7);
    let i1 = i0;
    while (i1 + 1 < count && colStart(i1 + 1).slice(0, 7) === key) i1 += 1;
    sheet.text(grid0 + i0, 5, monthLabel(colStart(i0), true), monthHead);
    if (i1 > i0) sheet.merge({ c1: grid0 + i0, r1: 5, c2: grid0 + i1, r2: 5 }, monthHead);
    i0 = i1 + 1;
  }
  sheet.blank(0, 6, th);
  const heads = ['Item', 'Start', 'End', 'Days', ...(gantt ? ['Depends on', 'Critical'] : [])];
  heads.forEach((h, i) => sheet.text(1 + i, 6, h, i >= 1 && i <= 3 ? look.thRight : th));
  const todayIdx: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const isToday = view.today >= colStart(i) && view.today <= colEnd(i);
    if (isToday) todayIdx.push(i);
    // The day of the month (of the week's Monday at the week zoom).
    const label = String(Number(colStart(i).slice(8, 10)));
    sheet.text(grid0 + i, 6, label, isToday ? thToday : thCenter);
  }
  const todaySet = new Set(todayIdx);

  const rule = thin(PALETTE.rule);
  const todaySide = thin(PALETTE.stuck);
  const gridStyle = (fill: string | undefined, today: boolean, critical: boolean) =>
    look.st.style({
      fill,
      border: {
        bottom: critical ? medium(PALETTE.brandDark) : rule,
        top: critical ? medium(PALETTE.brandDark) : undefined,
        left: today ? todaySide : undefined,
        right: today ? todaySide : undefined,
      },
    });
  const textStyle = (spec: StyleSpec) =>
    look.st.style({
      border: { bottom: rule },
      align: { h: 'left', v: 'center', indent: 1 },
      ...spec,
    });
  const dateStyle = textStyle({
    numFmt: 'd mmm yyyy',
    align: { h: 'right', v: 'center', indent: 1 },
  });
  const numStyle = textStyle({ align: { h: 'right', v: 'center', indent: 1 } });
  const criticalText = textStyle({
    font: { bold: true, color: PALETTE.brand },
    align: { h: 'center', v: 'center' },
  });

  let row = 7;
  for (const r of view.rows) {
    if (r.kind === 'group') {
      sheet.setHeight(row, 22);
      const color = r.color ?? PALETTE.textMuted;
      sheet.blank(0, row, look.fillOnly(color));
      const groupStyle = look.st.style({
        font: { bold: true, color },
        fill: PALETTE.band,
        border: { bottom: thin(color) },
        align: { h: 'left', v: 'center', indent: 1 },
      });
      sheet.text(1, row, r.title, groupStyle);
      for (let c = 2; c <= last; c += 1) sheet.blank(c, row, groupStyle);
      row += 1;
      continue;
    }
    sheet.setHeight(row, ROW_H);
    sheet.blank(0, row, look.fillOnly(r.groupColor ?? PALETTE.empty));
    sheet.text(1, row, r.name, textStyle({}));
    sheet.number(2, row, serial(r.from), dateStyle);
    sheet.number(3, row, serial(r.to), dateStyle);
    sheet.number(4, row, daysBetween(r.from, r.to) + 1, numStyle);
    if (gantt) {
      sheet.text(5, row, r.dependsOn ?? '', textStyle({ font: { color: PALETTE.textMuted } }));
      if (r.critical) sheet.text(6, row, 'Yes', criticalText);
      else sheet.blank(6, row, textStyle({}));
    }
    const color = r.color ?? PALETTE.brand;
    for (let i = 0; i < count; i += 1) {
      const on = r.from <= colEnd(i) && r.to >= colStart(i);
      const weekend = !weekly && [0, 6].includes(weekday(colStart(i)));
      const fill = on ? color : weekend ? PALETTE.band : undefined;
      sheet.blank(grid0 + i, row, gridStyle(fill, todaySet.has(i), on && r.critical === true));
    }
    sheet.flushBefore(row);
    row += 1;
  }
  if (items.length === 0)
    noteRow(sheet, look, row, 1, Math.max(left - 1, 1), `No item has a ${view.columnTitle} value.`);
  return sheet;
}

// ---- Chart ----

function chartSheet(look: Look, data: BoardWorkbookData, view: ChartViewData): SheetWriter {
  const stacked = view.chartType === 'stacked_bar' && view.series.length > 0;
  const valueCols = stacked ? view.series.length : 1;
  const dataLast = 1 + valueCols;
  const chartCol = dataLast + 2;
  const chartCols = 8;
  const last = chartCol + chartCols;
  const sheet = newSheet(VIEW_SHEET_NAMES.chart);
  sheet.setWidth(0, 2);
  sheet.setWidth(1, 28);
  for (let c = 2; c <= dataLast; c += 1) sheet.setWidth(c, 12);
  sheet.setWidth(dataLast + 1, 3);
  for (let c = chartCol; c < chartCol + chartCols; c += 1) sheet.setWidth(c, 10);
  sheet.setWidth(last, 2);
  header(sheet, look, data, last, subtitleText(data, `Chart: ${view.name}`), true);
  sheet.setHeight(4, 10);

  sheet.setHeight(5, 26);
  sheet.text(1, 5, 'DATA', look.section);
  sheet.merge({ c1: 1, r1: 5, c2: dataLast, r2: 5 }, look.section);
  sheet.text(chartCol, 5, view.title.toUpperCase(), look.section);
  sheet.merge({ c1: chartCol, r1: 5, c2: chartCol + chartCols - 1, r2: 5 }, look.section);
  sheet.setHeight(6, 24);
  sheet.text(1, 6, view.xTitle, look.th);
  if (stacked) view.series.forEach((s, i) => sheet.text(2 + i, 6, s.label, look.thRight));
  else sheet.text(2, 6, view.yLabel, look.thRight);

  const value = look.st.style({
    border: { bottom: thin(PALETTE.rule) },
    align: { h: 'right', v: 'center', indent: 1 },
  });
  let row = 7;
  view.buckets.forEach((b, k) => {
    sheet.setHeight(row, ROW_H);
    sheet.text(1, row, b.label, b.color ? look.labelCell(b.color) : look.td);
    if (stacked) {
      view.series.forEach((_, i) => sheet.number(2 + i, row, view.stacked[k]?.[i] ?? 0, value));
    } else if (b.value === null) sheet.blank(2, row, value);
    else sheet.number(2, row, b.value, value);
    row += 1;
  });
  const first = 7;
  const lastData = row - 1;
  if (view.buckets.length === 0) {
    noteRow(sheet, look, row, 1, dataLast, 'Nothing to chart: no item has a value on the X axis.');
    row += 1;
  } else if (!stacked) {
    sheet.dataBar({ c1: 2, r1: first, c2: 2, r2: lastData }, PALETTE.bar);
  }
  for (const n of view.notes) {
    noteRow(sheet, look, row, 1, dataLast, n);
    row += 1;
  }

  if (view.buckets.length > 0) {
    const q = quoteSheet(sheet.name);
    const categoriesRef = `${q}!${absRange(1, first, 1, lastData)}`;
    const categories = view.buckets.map((b) => b.label);
    const colors = view.buckets.map((b, i) => b.color ?? SERIES_COLORS[i % SERIES_COLORS.length]!);
    const anchor = { fromCol: chartCol, fromRow: 5, toCol: chartCol + chartCols, toRow: 5 + 20 };
    const common = {
      title: view.title,
      categoriesRef,
      categories,
      anchor,
      showValues: view.showValues,
    };
    let spec: ChartSpec;
    if (stacked) {
      spec = {
        ...common,
        kind: 'bar',
        grouping: 'stacked',
        showLegend: true,
        series: view.series.map((s, i) => ({
          name: s.label,
          nameRef: `${q}!${absRange(2 + i, 6, 2 + i, 6)}`,
          valuesRef: `${q}!${absRange(2 + i, first, 2 + i, lastData)}`,
          values: view.buckets.map((_, k) => view.stacked[k]?.[i] ?? 0),
          color: s.color,
        })),
      };
    } else {
      const series = {
        name: view.yLabel,
        nameRef: `${q}!${absRange(2, 6, 2, 6)}`,
        valuesRef: `${q}!${absRange(2, first, 2, lastData)}`,
        values: view.buckets.map((b) => b.value),
        color: PALETTE.brand,
      };
      if (view.chartType === 'line') spec = { ...common, kind: 'line', series: [series] };
      else if (view.chartType === 'pie' || view.chartType === 'donut') {
        spec = {
          ...common,
          kind: view.chartType === 'pie' ? 'pie' : 'doughnut',
          showLegend: view.showLegend,
          series: [{ ...series, pointColors: colors }],
        };
      } else spec = { ...common, kind: 'bar', series: [{ ...series, pointColors: colors }] };
    }
    sheet.addChart(spec);
    for (let r = row; r < 26; r += 1) sheet.setHeight(r, ROW_H);
  }
  return sheet;
}

// ---- Workload ----

/** Most periods a Workload sheet shows (the web caps; the note says so). */
export const WORKLOAD_SHEET_PERIODS = 104;

function workloadSheet(look: Look, data: BoardWorkbookData, view: WorkloadViewData): SheetWriter {
  const periods = view.periods.length;
  const totalCol = 2 + periods;
  const last = totalCol + 1;
  const sheet = newSheet(VIEW_SHEET_NAMES.workload, { cols: 2, rows: 6 });
  sheet.setWidth(0, 2);
  sheet.setWidth(1, 24);
  for (let i = 0; i < periods; i += 1) sheet.setWidth(2 + i, 9);
  sheet.setWidth(totalCol, 11);
  sheet.setWidth(last, 2);
  header(sheet, look, data, last, subtitleText(data, `Workload: ${view.name}`), true);
  noteRow(
    sheet,
    look,
    4,
    1,
    Math.max(1, Math.min(totalCol, 8)),
    `${view.measureLabel} per ${view.peopleTitle} and period. Blue: under capacity, green: balanced, red: over.${view.note ? ` ${view.note}` : ''}`,
  );
  sheet.setHeight(5, 8);
  sheet.setHeight(6, 30);
  const thToday = look.st.style({
    font: { bold: true, color: PALETTE.white },
    fill: PALETTE.brand,
    border: { bottom: thin(PALETTE.brand) },
    align: { h: 'center', v: 'center', wrap: true },
  });
  const thCenter = look.st.style({
    font: { bold: true },
    fill: PALETTE.brandTint,
    border: { bottom: thin(PALETTE.brand) },
    align: { h: 'center', v: 'center', wrap: true },
  });
  sheet.text(1, 6, view.peopleTitle, look.th);
  view.periods.forEach((p, i) => sheet.text(2 + i, 6, p.label, p.today ? thToday : thCenter));
  sheet.text(totalCol, 6, 'Total', look.thRight);

  const cell = (level: WorkloadLevelName) =>
    look.st.style({
      fill: WORKLOAD_FILL[level] ?? undefined,
      border: { bottom: thin(PALETTE.white), right: thin(PALETTE.white) },
      align: { h: 'center', v: 'center' },
    });
  let row = 7;
  for (const r of view.rows) {
    sheet.setHeight(row, ROW_H);
    sheet.text(1, row, r.name, look.td);
    r.values.forEach((v, i) => {
      const level = r.levels[i] ?? 'empty';
      if (v === 0) sheet.blank(2 + i, row, cell(level));
      else sheet.number(2 + i, row, Math.round(v * 10) / 10, cell(level));
    });
    sheet.number(totalCol, row, Math.round(r.total * 10) / 10, look.totalCount);
    row += 1;
  }
  const first = 7;
  const lastRow = row - 1;
  if (view.rows.length === 0) {
    noteRow(
      sheet,
      look,
      row,
      1,
      Math.max(1, Math.min(totalCol, 8)),
      'No item has both a date and a person.',
    );
    return sheet;
  }
  sheet.dataBar({ c1: totalCol, r1: first, c2: totalCol, r2: lastRow }, PALETTE.bar);

  // A native bar chart of the totals, under the table.
  const top = row + 1;
  sheet.setHeight(top, 26);
  sheet.text(1, top, `TOTAL BY ${view.peopleTitle.toUpperCase()}`, look.section);
  const q = quoteSheet(sheet.name);
  const height = Math.max(12, Math.min(30, view.rows.length * 2 + 4));
  sheet.addChart({
    kind: 'bar',
    direction: 'bar',
    title: `${view.measureLabel} by ${view.peopleTitle.toLowerCase()}`,
    categoriesRef: `${q}!${absRange(1, first, 1, lastRow)}`,
    categories: view.rows.map((r) => r.name),
    series: [
      {
        name: 'Total',
        nameRef: `${q}!${absRange(totalCol, 6, totalCol, 6)}`,
        valuesRef: `${q}!${absRange(totalCol, first, totalCol, lastRow)}`,
        values: view.rows.map((r) => Math.round(r.total * 10) / 10),
        color: PALETTE.brand,
      },
    ],
    anchor: { fromCol: 1, fromRow: top, toCol: Math.min(totalCol + 1, 9), toRow: top + height },
  });
  return sheet;
}

/** The sheet of one view. */
export function buildViewSheet(
  look: Look,
  data: BoardWorkbookData,
  view: ViewSheetData,
): SheetWriter {
  switch (view.type) {
    case 'kanban':
      return kanbanSheet(look, data, view);
    case 'calendar':
      return calendarSheet(look, data, view);
    case 'timeline':
    case 'gantt':
      return timelineSheet(look, data, view);
    case 'chart':
      return chartSheet(look, data, view);
    case 'workload':
      return workloadSheet(look, data, view);
  }
}
