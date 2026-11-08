/**
 * The designed board workbook (spec `docs/specs/P6-export-workbook.md`): a Summary dashboard and
 * the Items table. It takes plain data the web app computes with the app's own models, lays it
 * out with Atrium's look and returns the package parts. Pure: no DOM, no Firebase.
 */
import type { CsvCell } from '../columns/csv';
import type { ChartSpec } from './chart';
import { buildPackage } from './package';
import { Look, ROW_H, SUMMARY_SHEET, header, medium, subtitleText, thin } from './look';
import { PALETTE } from './palette';
import { SheetWriter, type Range } from './sheet';
import type { BorderSide, StyleSpec } from './styles';
import { absRange, quoteSheet } from './xml';

/** One row of a breakdown table (status labels, groups, people). */
export interface WorkbookCount {
  label: string;
  /** `#RRGGBB`, or `null` for a neutral row ("Not set", "Unassigned"). */
  color: string | null;
  count: number;
  /** Items of the row that are done (groups and people tables). */
  done?: number;
}

export interface WorkbookBreakdown {
  /** The column's title ("Status", "Priority"), or the table's subject ("Groups"). */
  title: string;
  rows: WorkbookCount[];
  /** Rows left out by a cap (people), told in a note. */
  more?: number;
}

/** Headline figures. `null` = the board has no column to compute it from. */
export interface WorkbookFigures {
  items: number;
  groups: number;
  done: number | null;
  inProgress: number | null;
  overdue: number | null;
  dueSoon: number | null;
  noDate: number | null;
  people: number | null;
}

export interface WorkbookItemRow {
  /** Cells in header order: Item, Group, Parent item (when present), then the board columns. */
  cells: CsvCell[];
  /** The row's group colour (subitems: the parent's). */
  groupColor: string | null;
  subitem: boolean;
}

export interface BoardWorkbookData {
  boardName: string;
  /** Shown in the subtitle and the source line: "8 Nov 2026, 14:32". */
  exportedLabel: string;
  /** ISO 8601 time for the document properties. */
  createdAt: string;
  /** Set for a batch-bar export: the number of selected items and of the board's items. */
  selection: { count: number; total: number } | null;
  /** Colours of the stripe under the banner (status label colours, else group colours). */
  stripe: string[];
  figures: WorkbookFigures;
  status: WorkbookBreakdown | null;
  priority: WorkbookBreakdown | null;
  groups: WorkbookBreakdown;
  people: WorkbookBreakdown | null;
  items: {
    /** Header texts: Item, Group, Parent item (when `hasSubitems`), then the board columns. */
    header: string[];
    hasSubitems: boolean;
    rows: WorkbookItemRow[];
  };
}

export { SUMMARY_SHEET } from './look';
export const ITEMS_SHEET = 'Items';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
/** Ticked checkbox cells. */
export const CHECK_MARK = '✓';
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Formula guard: text a sheet could read as a formula gets a leading `'` (it stays a string). */
export function guardFormula(text: string): string {
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

/**
 * Excel serial number of a `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS` text (1900 date system), or
 * `null` when the text is not a real date. Days since 1899-12-30; the fraction is the time.
 */
export function excelSerialDate(text: string): { serial: number; hasTime: boolean } | null {
  const full = DATE_TIME.exec(text);
  const match = full ?? DATE_ONLY.exec(text);
  if (!match) return null;
  const [y, m, d, hh = 0, mm = 0, ss = 0] = match.slice(1).map(Number) as number[];
  const ms = Date.UTC(y as number, (m as number) - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== (m as number) - 1) return null;
  if (check.getUTCDate() !== d) return null;
  if ((hh as number) > 23 || (mm as number) > 59 || (ss as number) > 59) return null;
  const days = (ms - Date.UTC(1899, 11, 30)) / 86_400_000;
  return {
    serial: days + ((hh as number) * 3600 + (mm as number) * 60 + (ss as number)) / 86_400,
    hasTime: full !== null,
  };
}

// ---- Summary ----

/** Summary grid: gutter, left panel (3 columns), gutter, right panel (3 columns), gutter. */
const SUMMARY_WIDTHS = [2, 24, 11, 11, 3, 24, 11, 11, 2];
const LEFT = 1;
const RIGHT = 5;
const SUMMARY_LAST = SUMMARY_WIDTHS.length - 1;
const CHART_ROWS = 14;

type Section = (sheet: SheetWriter, top: number, col: number) => number;

interface Card {
  label: string;
  value: number | null;
  note: string;
  color: string;
}

const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 100));

function cards(f: WorkbookFigures): Card[] {
  const brand = PALETTE.brand;
  const noStatus = 'No status column';
  const noDate = 'No date column';
  return [
    { label: 'ITEMS', value: f.items, note: 'Top-level items', color: brand },
    {
      label: 'DONE',
      value: f.done,
      note: f.done === null ? noStatus : `${pct(f.done, f.items)}% of items`,
      color: PALETTE.done,
    },
    {
      label: 'IN PROGRESS',
      value: f.inProgress,
      note: f.inProgress === null ? noStatus : 'Has a status, not done',
      color: brand,
    },
    {
      label: 'OVERDUE',
      value: f.overdue,
      note: f.overdue === null ? noDate : 'Not done, date passed',
      color: f.overdue ? PALETTE.stuck : brand,
    },
    {
      label: 'DUE IN 7 DAYS',
      value: f.dueSoon,
      note: f.dueSoon === null ? noDate : 'Not done, due this week',
      color: brand,
    },
    {
      label: 'NO DATE',
      value: f.noDate,
      note: f.noDate === null ? noDate : 'Items without a date',
      color: PALETTE.textMuted,
    },
    {
      label: 'PEOPLE',
      value: f.people,
      note: f.people === null ? 'No people column' : 'Assigned to items',
      color: brand,
    },
    { label: 'GROUPS', value: f.groups, note: 'On the board', color: brand },
  ];
}

/** Card spans in the Summary grid: B, C:D, F, G:H. */
const CARD_SPANS: readonly [number, number][] = [
  [1, 1],
  [2, 3],
  [5, 5],
  [6, 7],
];

function writeCards(sheet: SheetWriter, look: Look, list: readonly Card[], top: number): number {
  const gap: BorderSide = { style: 'thick', color: PALETTE.white };
  const base = (extra: StyleSpec): StyleSpec => ({
    fill: PALETTE.band,
    ...extra,
    border: { left: gap, right: gap, ...extra.border },
  });
  let row = top;
  for (let i = 0; i < list.length; i += 4) {
    sheet.setHeight(row, 20);
    sheet.setHeight(row + 1, 34);
    sheet.setHeight(row + 2, 18);
    list.slice(i, i + 4).forEach((card, k) => {
      const [c1, c2] = CARD_SPANS[k] as [number, number];
      const labelStyle = look.st.style(
        base({
          font: { size: 8, bold: true, color: PALETTE.textMuted },
          border: { top: medium(card.color) },
          align: { h: 'left', v: 'bottom', indent: 1 },
        }),
      );
      const valueStyle = look.st.style(
        base({
          font: {
            size: card.value === null ? 12 : 20,
            bold: true,
            color: card.value === null ? PALETTE.textMuted : card.color,
          },
          numFmt: '#,##0',
          align: { h: 'left', v: 'center', indent: 1 },
        }),
      );
      const noteStyle = look.st.style(
        base({
          font: { size: 8, color: PALETTE.textMuted },
          align: { h: 'left', v: 'top', indent: 1 },
        }),
      );
      sheet.text(c1, row, card.label, labelStyle);
      if (card.value === null) sheet.text(c1, row + 1, 'n/a', valueStyle);
      else sheet.number(c1, row + 1, card.value, valueStyle);
      sheet.text(c1, row + 2, card.note, noteStyle);
      if (c2 > c1) {
        sheet.merge({ c1, r1: row, c2, r2: row }, labelStyle);
        sheet.merge({ c1, r1: row + 1, c2, r2: row + 1 }, valueStyle);
        sheet.merge({ c1, r1: row + 2, c2, r2: row + 2 }, noteStyle);
      }
    });
    row += 3;
    if (i + 4 < list.length) {
      sheet.setHeight(row, 8);
      row += 1;
    }
  }
  return row;
}

function sectionBar(sheet: SheetWriter, look: Look, row: number, col: number, title: string): void {
  sheet.setHeight(row, 26);
  sheet.text(col, row, title.toUpperCase(), look.section);
  sheet.merge({ c1: col, r1: row, c2: col + 2, r2: row }, look.section);
}

/** Label / Items / Share (or Done) table with a data bar on Items. Returns the row after it. */
function breakdownTable(
  sheet: SheetWriter,
  look: Look,
  top: number,
  col: number,
  table: WorkbookBreakdown,
  third: 'share' | 'done',
  firstHeader: string,
): { next: number; labels: Range; counts: Range } {
  sectionBar(sheet, look, top, col, table.title);
  const head = top + 1;
  sheet.setHeight(head, 24);
  sheet.text(col, head, firstHeader, look.th);
  sheet.text(col + 1, head, 'Items', look.thRight);
  sheet.text(col + 2, head, third === 'share' ? 'Share' : 'Done', look.thRight);
  const total = table.rows.reduce((n, r) => n + r.count, 0);
  let row = head + 1;
  for (const r of table.rows) {
    sheet.setHeight(row, ROW_H);
    sheet.text(col, row, r.label, look.labelCell(r.color));
    sheet.number(col + 1, row, r.count, look.tdCount);
    if (third === 'share')
      sheet.number(col + 2, row, total === 0 ? 0 : r.count / total, look.tdShare);
    else sheet.number(col + 2, row, r.done ?? 0, look.tdCount);
    row += 1;
  }
  const first = head + 1;
  const last = row - 1;
  if (table.rows.length === 0) {
    sheet.setHeight(row, ROW_H);
    sheet.text(col, row, 'No items', look.td);
    row += 1;
  } else {
    sheet.dataBar({ c1: col + 1, r1: first, c2: col + 1, r2: last }, PALETTE.bar);
  }
  sheet.setHeight(row, ROW_H);
  sheet.text(col, row, 'Total', look.totalLabel);
  sheet.number(col + 1, row, total, look.totalCount);
  if (third === 'share') sheet.number(col + 2, row, total === 0 ? 0 : 1, look.totalShare);
  else {
    const done = table.rows.reduce((n, r) => n + (r.done ?? 0), 0);
    sheet.number(col + 2, row, done, look.totalCount);
  }
  row += 1;
  if (table.more && table.more > 0) {
    sheet.text(col, row, `and ${table.more} more not listed`, look.note);
    sheet.merge({ c1: col, r1: row, c2: col + 2, r2: row }, look.note);
    row += 1;
  }
  return {
    next: row,
    labels: { c1: col, r1: first, c2: col, r2: Math.max(first, last) },
    counts: { c1: col + 1, r1: first, c2: col + 1, r2: Math.max(first, last) },
  };
}

function distributionChart(
  sheet: SheetWriter,
  table: WorkbookBreakdown,
  labels: Range,
  counts: Range,
  top: number,
  col: number,
  title: string,
): ChartSpec | null {
  if (table.rows.length === 0) return null;
  const q = quoteSheet(sheet.name);
  return {
    kind: 'bar',
    title,
    categoriesRef: `${q}!${absRange(labels.c1, labels.r1, labels.c2, labels.r2)}`,
    categories: table.rows.map((r) => r.label),
    series: [
      {
        name: 'Items',
        valuesRef: `${q}!${absRange(counts.c1, counts.r1, counts.c2, counts.r2)}`,
        values: table.rows.map((r) => r.count),
        color: PALETTE.brand,
        pointColors: table.rows.map((r) => r.color ?? PALETTE.empty),
      },
    ],
    // `to` is exclusive: the chart covers the panel's three columns and CHART_ROWS rows.
    anchor: { fromCol: col, fromRow: top, toCol: col + 3, toRow: top + CHART_ROWS },
  };
}

interface SheetLink {
  name: string;
  description: string;
}

function linksSection(look: Look, links: readonly SheetLink[]): Section {
  return (sheet, top, col) => {
    sectionBar(sheet, look, top, col, 'In this workbook');
    let row = top + 1;
    for (const l of links) {
      sheet.setHeight(row, 30);
      sheet.text(col, row, l.name, look.link);
      sheet.link(col, row, `${quoteSheet(l.name)}!A1`, l.name);
      sheet.text(col + 1, row, l.description, look.linkNote);
      sheet.merge({ c1: col + 1, r1: row, c2: col + 2, r2: row }, look.linkNote);
      row += 1;
    }
    return row;
  };
}

function buildSummary(
  look: Look,
  data: BoardWorkbookData,
  links: readonly SheetLink[],
): SheetWriter {
  const sheet = new SheetWriter(SUMMARY_SHEET, {
    tabColor: PALETTE.brand,
    showGridLines: false,
    fitToWidth: true,
  });
  SUMMARY_WIDTHS.forEach((w, c) => sheet.setWidth(c, w));
  header(sheet, look, data, SUMMARY_LAST, subtitleText(data, 'Board summary'), false);
  sheet.setHeight(4, 12);

  sheet.setHeight(5, 26);
  sheet.text(LEFT, 5, 'AT A GLANCE', look.section);
  sheet.merge({ c1: LEFT, r1: 5, c2: RIGHT + 2, r2: 5 }, look.section);
  sheet.setHeight(6, 8);
  let row = writeCards(sheet, look, cards(data.figures), 7);
  sheet.setHeight(row, 14);
  row += 1;

  // Tables in order; the first one gets the chart in the right panel.
  const tables: { table: WorkbookBreakdown; third: 'share' | 'done'; first: string }[] = [];
  if (data.status) tables.push({ table: data.status, third: 'share', first: 'Label' });
  if (data.priority) tables.push({ table: data.priority, third: 'share', first: 'Label' });
  tables.push({ table: data.groups, third: 'done', first: 'Group' });
  if (data.people) tables.push({ table: data.people, third: 'done', first: 'Person' });

  const toSection =
    (t: (typeof tables)[number]): Section =>
    (s, top, col) =>
      breakdownTable(s, look, top, col, t.table, t.third, t.first).next;

  const firstTable = tables[0]!;
  {
    const top = row;
    const placed = breakdownTable(
      sheet,
      look,
      top,
      LEFT,
      firstTable.table,
      firstTable.third,
      firstTable.first,
    );
    sectionBar(sheet, look, top, RIGHT, `${firstTable.table.title} chart`);
    const chart = distributionChart(
      sheet,
      firstTable.table,
      placed.labels,
      placed.counts,
      top,
      RIGHT,
      `Items by ${firstTable.table.title.toLowerCase()}`,
    );
    if (chart) sheet.addChart(chart);
    const end = Math.max(placed.next, top + 1 + CHART_ROWS);
    for (let r = placed.next; r < end; r += 1) sheet.setHeight(r, ROW_H);
    row = end + 1;
  }

  const rest: Section[] = [...tables.slice(1).map(toSection), linksSection(look, links)];
  for (let i = 0; i < rest.length; i += 2) {
    const top = row;
    const leftEnd = rest[i]!(sheet, top, LEFT);
    const right = rest[i + 1];
    const rightEnd = right ? right(sheet, top, RIGHT) : top;
    row = Math.max(leftEnd, rightEnd) + 1;
  }

  const scope = data.selection
    ? 'Figures describe the selected items only.'
    : 'Figures count top-level items; subitems are listed on the Items sheet.';
  sheet.setHeight(row, 30);
  sheet.text(LEFT, row, `Exported from Atrium on ${data.exportedLabel}. ${scope}`, look.note);
  sheet.merge({ c1: LEFT, r1: row, c2: RIGHT + 2, r2: row }, look.note);
  return sheet;
}

// ---- Items ----

const ITEM_MIN = 28;
const ITEM_MAX = 50;
const COL_MIN = 10;
const COL_MAX = 45;
const LINE_PT = 15;
const MAX_LINES = 4;

type Kind =
  | 'text'
  | 'wrap'
  | 'number'
  | 'date'
  | 'datetime'
  | 'true'
  | 'false'
  | 'name'
  | 'subname'
  | 'group'
  | 'parent';

const longestLine = (text: string): number =>
  text.split(/\r\n|\r|\n/).reduce((max, line) => Math.max(max, line.length), 0);

function buildItems(look: Look, data: BoardWorkbookData): SheetWriter {
  const { header: head, rows, hasSubitems } = data.items;
  const firstData = hasSubitems ? 4 : 3; // index in `cells` of the first board column
  const colCount = head.length + 1; // + the group marker
  const last = colCount - 1;
  const sheet = new SheetWriter(ITEMS_SHEET, {
    tabColor: PALETTE.done,
    showGridLines: false,
    freeze: { cols: 2, rows: 4 },
    landscape: true,
    fitToWidth: true,
  });
  header(sheet, look, data, last, subtitleText(data, 'All items'), true);

  // Header row.
  sheet.setHeight(4, 28);
  sheet.blank(0, 4, look.th);
  head.forEach((title, i) => {
    sheet.text(i + 1, 4, guardFormula(title), i + 1 >= firstData ? look.th : look.th);
  });

  const widths = head.map((t) => longestLine(t) + 2);
  const styleCache = new Map<string, number>();
  const styleFor = (kind: Kind, band: boolean, color: string | null = null): number => {
    const key = `${kind}|${band ? 1 : 0}|${color ?? ''}`;
    const hit = styleCache.get(key);
    if (hit !== undefined) return hit;
    const fill = band ? PALETTE.band : undefined;
    const rule = { bottom: thin(PALETTE.rule) };
    let spec: StyleSpec;
    switch (kind) {
      case 'name':
        spec = { fill, border: rule, align: { h: 'left', v: 'center', wrap: true, indent: 1 } };
        break;
      case 'subname':
        spec = {
          fill,
          border: rule,
          font: { color: PALETTE.textMuted },
          align: { h: 'left', v: 'center', wrap: true, indent: 3 },
        };
        break;
      case 'group':
        spec = {
          fill,
          border: rule,
          font: { bold: true, color: color ?? PALETTE.textMuted },
          align: { h: 'left', v: 'center', indent: 1 },
        };
        break;
      case 'parent':
        spec = {
          fill,
          border: rule,
          font: { color: PALETTE.textMuted },
          align: { h: 'left', v: 'center', indent: 1 },
        };
        break;
      case 'number':
        spec = { fill, border: rule, align: { h: 'right', v: 'center', indent: 1 } };
        break;
      case 'date':
        spec = {
          fill,
          border: rule,
          numFmt: 'd mmm yyyy',
          align: { h: 'left', v: 'center', indent: 1 },
        };
        break;
      case 'datetime':
        spec = {
          fill,
          border: rule,
          numFmt: 'd mmm yyyy hh:mm',
          align: { h: 'left', v: 'center', indent: 1 },
        };
        break;
      case 'true':
        spec = {
          fill,
          border: rule,
          font: { bold: true, color: PALETTE.done },
          align: { h: 'center', v: 'center' },
        };
        break;
      case 'false':
        spec = {
          fill,
          border: rule,
          font: { color: PALETTE.empty },
          align: { h: 'center', v: 'center' },
        };
        break;
      case 'wrap':
        spec = { fill, border: rule, align: { h: 'left', v: 'center', wrap: true, indent: 1 } };
        break;
      default:
        spec = { fill, border: rule, align: { h: 'left', v: 'center', indent: 1 } };
    }
    const id = look.st.style(spec);
    styleCache.set(key, id);
    return id;
  };

  const lines = new Array<number>(head.length).fill(0);
  let band = false;
  let r = 5;
  for (const item of rows) {
    if (!item.subitem) band = !band;
    const isBand = !band; // the first item is white
    sheet.blank(0, r, look.fillOnly(item.groupColor ?? PALETTE.empty));
    let rowLines = 1;
    item.cells.forEach((cell, i) => {
      const col = i + 1;
      const textOf = typeof cell === 'string' ? cell : cell.text;
      const measured = (n: number) => {
        widths[i] = Math.max(widths[i] ?? 0, n + 2);
      };
      lines[i] = 0;
      if (i === 0) {
        const name = guardFormula(textOf);
        sheet.text(col, r, name, styleFor(item.subitem ? 'subname' : 'name', isBand));
        measured(longestLine(name) + (item.subitem ? 4 : 0));
        lines[i] = textLines(name, ITEM_MAX);
      } else if (i === 1) {
        sheet.text(col, r, guardFormula(textOf), styleFor('group', isBand, item.groupColor));
        measured(textOf.length);
      } else if (hasSubitems && i === 2) {
        sheet.text(col, r, guardFormula(textOf), styleFor('parent', isBand));
        measured(textOf.length);
      } else if (typeof cell === 'string') {
        const text = guardFormula(cell);
        const wrap = /\n/.test(text) || text.length > COL_MAX;
        sheet.text(col, r, text, styleFor(wrap ? 'wrap' : 'text', isBand));
        measured(longestLine(text));
        if (wrap) lines[i] = textLines(text, COL_MAX);
      } else if ('numeric' in cell) {
        const n = PLAIN_NUMBER.test(cell.text) ? Number(cell.text) : Number.NaN;
        if (Number.isFinite(n)) sheet.number(col, r, n, styleFor('number', isBand));
        else sheet.text(col, r, guardFormula(cell.text), styleFor('text', isBand));
        measured(cell.text.length);
      } else if ('date' in cell) {
        const date = excelSerialDate(cell.text);
        if (date) {
          sheet.number(col, r, date.serial, styleFor(date.hasTime ? 'datetime' : 'date', isBand));
          measured(date.hasTime ? 17 : 11);
        } else {
          sheet.text(col, r, guardFormula(cell.text), styleFor('text', isBand));
          measured(cell.text.length);
        }
      } else if ('checkbox' in cell) {
        // A check mark, not a boolean cell: Numbers and Quick Look do not show TRUE/FALSE cells.
        if (cell.text !== '') sheet.text(col, r, CHECK_MARK, styleFor('true', isBand));
        else sheet.blank(col, r, styleFor('false', isBand));
        measured(5);
      } else {
        // A status-like label; an empty one is grey, as in the table.
        sheet.text(col, r, guardFormula(cell.text), look.labelCell(cell.color));
        measured(cell.text.length + 2);
      }
      rowLines = Math.max(rowLines, lines[i] ?? 0);
    });
    // Cells a short row leaves out still get the band and the separator.
    for (let c = item.cells.length + 1; c <= last; c += 1)
      sheet.blank(c, r, styleFor('text', isBand));
    sheet.setHeight(r, rowLines > 1 ? Math.min(rowLines, MAX_LINES) * LINE_PT + 5 : ROW_H);
    sheet.flushBefore(r);
    r += 1;
  }
  const lastRow = Math.max(r - 1, 4);
  if (rows.length === 0) {
    sheet.text(1, 5, 'No items to export', look.note);
  }

  sheet.setWidth(0, 1.3);
  widths.forEach((w, i) => {
    const min = i === 0 ? ITEM_MIN : COL_MIN;
    const max = i === 0 ? ITEM_MAX : COL_MAX;
    sheet.setWidth(i + 1, Math.min(max, Math.max(min, w)));
  });
  sheet.setAutoFilter({ c1: 1, r1: 4, c2: last, r2: lastRow });
  sheet.setPrintTitleRows(4, 4);
  return sheet;
}

/** Visual lines a wrapped text takes in a column `width` characters wide. */
function textLines(text: string, width: number): number {
  return text
    .split(/\r\n|\r|\n/)
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / Math.max(1, width - 2))), 0);
}

/** The workbook's parts: Summary, then Items. */
export function buildBoardWorkbookParts(data: BoardWorkbookData): Record<string, string> {
  const look = new Look();
  const itemCount = data.items.rows.length;
  const links: SheetLink[] = [
    {
      name: ITEMS_SHEET,
      description: `Every exported row (${itemCount} ${itemCount === 1 ? 'row' : 'rows'}) with its visible columns`,
    },
  ];
  const summary = buildSummary(look, data, links);
  const items = buildItems(look, data);
  return buildPackage({
    sheets: [summary, items],
    styles: look.st,
    title: data.boardName || 'Board',
    createdAt: data.createdAt,
  });
}
