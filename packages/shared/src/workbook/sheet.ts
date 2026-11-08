/**
 * Writer for one worksheet. Cells are set by (zero-based column, one-based row); rows can be
 * flushed to finished XML as soon as they are complete (`flushBefore`), so a sheet of thousands of
 * rows never keeps more than one row of cell entries. `xml()` writes the worksheet children in the
 * order `CT_Worksheet` requires. Pure: no DOM.
 */
import type { ChartSpec } from './chart';
import { argb } from './palette';
import {
  XML_HEADER,
  absRange,
  clampCellText,
  needsPreserve,
  quoteSheet,
  rangeRef,
  stripIllegalXmlChars,
  xmlEscape,
} from './xml';

export const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const NS_XM = 'http://schemas.microsoft.com/office/excel/2006/main';

/** Excel's limits for sheet names: 31 characters, none of `[]:*?/\`. */
export function safeSheetName(name: string): string {
  const cleaned = stripIllegalXmlChars(name)
    .replace(/[[\]:*?/\\]/g, '-')
    .replace(/^'+|'+$/g, '')
    .trim();
  return (cleaned || 'Sheet').slice(0, 31);
}

export interface Range {
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}

interface DataBarRule {
  kind: 'dataBar';
  range: Range;
  color: string;
  priority: number;
  /** `{GUID}` linking the 2007 rule to its 2010 extension (solid bar). */
  id: string;
}

interface ExpressionRule {
  kind: 'expression';
  range: Range;
  formula: string;
  dxfId: number;
  priority: number;
}

type CfRule = DataBarRule | ExpressionRule;

interface Hyperlink {
  col: number;
  row: number;
  location: string;
  display: string;
}

interface PendingRow {
  cells: Map<number, string>;
  height?: number;
}

export interface SheetOptions {
  tabColor?: string;
  showGridLines?: boolean;
  /** Frozen columns (left) and rows (top). */
  freeze?: { cols: number; rows: number };
  landscape?: boolean;
  /** Fit the print to one page wide. */
  fitToWidth?: boolean;
}

const ref = (col: number, row: number) => rangeRef(col, row, col, row);

const overlaps = (a: Range, b: Range): boolean =>
  a.c1 <= b.c2 && b.c1 <= a.c2 && a.r1 <= b.r2 && b.r1 <= a.r2;

/** A deterministic, well-formed GUID per data bar (Excel only needs it unique in the sheet). */
function guid(n: number): string {
  return `{A7C1D2E3-0000-4000-8000-${n.toString(16).toUpperCase().padStart(12, '0')}}`;
}

export class SheetWriter {
  readonly name: string;
  readonly options: SheetOptions;
  private readonly done: string[] = [];
  private readonly pending = new Map<number, PendingRow>();
  /** Rows below this number are written and cannot change. */
  private flushedBefore = 1;
  private readonly widths = new Map<number, number>();
  private readonly merges: Range[] = [];
  private readonly rules: CfRule[] = [];
  private readonly links: Hyperlink[] = [];
  private autoFilter: Range | null = null;
  private printTitleRows: { from: number; to: number } | null = null;
  readonly charts: ChartSpec[] = [];
  private maxCol = 0;
  private maxRow = 1;
  private priority = 0;

  constructor(name: string, options: SheetOptions = {}) {
    this.name = safeSheetName(name);
    this.options = options;
  }

  /** `'Name'!A1` for a hyperlink or chart reference to this sheet. */
  refTo(col: number, row: number): string {
    return `${quoteSheet(this.name)}!${ref(col, row)}`;
  }

  setWidth(col: number, width: number): void {
    this.widths.set(col, width);
  }

  setHeight(row: number, height: number): void {
    this.row(row).height = height;
  }

  private row(row: number): PendingRow {
    if (!Number.isInteger(row) || row < this.flushedBefore || row > 1_048_576) {
      throw new Error(`Row ${row} is out of range or already written`);
    }
    let r = this.pending.get(row);
    if (!r) {
      r = { cells: new Map() };
      this.pending.set(row, r);
    }
    return r;
  }

  private put(col: number, row: number, xml: string): void {
    if (!Number.isInteger(col) || col < 0 || col > 16_383) throw new Error(`Bad column ${col}`);
    this.row(row).cells.set(col, xml);
    if (col > this.maxCol) this.maxCol = col;
    if (row > this.maxRow) this.maxRow = row;
  }

  /** A text cell (inline string). Empty text writes a styled blank. */
  text(col: number, row: number, text: string, style = 0): void {
    const safe = clampCellText(stripIllegalXmlChars(text));
    if (safe === '') {
      this.blank(col, row, style);
      return;
    }
    const s = style === 0 ? '' : ` s="${style}"`;
    const space = needsPreserve(safe) ? ' xml:space="preserve"' : '';
    this.put(
      col,
      row,
      `<c r="${ref(col, row)}"${s} t="inlineStr"><is><t${space}>${xmlEscape(safe)}</t></is></c>`,
    );
  }

  number(col: number, row: number, value: number, style = 0): void {
    if (!Number.isFinite(value)) {
      this.blank(col, row, style);
      return;
    }
    const s = style === 0 ? '' : ` s="${style}"`;
    this.put(col, row, `<c r="${ref(col, row)}"${s}><v>${String(value)}</v></c>`);
  }

  bool(col: number, row: number, value: boolean, style = 0): void {
    const s = style === 0 ? '' : ` s="${style}"`;
    this.put(col, row, `<c r="${ref(col, row)}"${s} t="b"><v>${value ? 1 : 0}</v></c>`);
  }

  /** A cell with a style and no value (fills, borders). */
  blank(col: number, row: number, style: number): void {
    if (style === 0) return;
    this.put(col, row, `<c r="${ref(col, row)}" s="${style}"/>`);
  }

  /** Styles every cell of a range that has no value yet (merged areas, bands). */
  fill(range: Range, style: number): void {
    for (let r = range.r1; r <= range.r2; r += 1) {
      const row = this.row(r);
      for (let c = range.c1; c <= range.c2; c += 1) {
        if (!row.cells.has(c)) this.blank(c, r, style);
      }
    }
  }

  /** Merges a range; the cells of the range get `style` so borders and fills cover it. */
  merge(range: Range, style?: number): void {
    if (range.c2 < range.c1 || range.r2 < range.r1) throw new Error('Bad merge range');
    if (range.c1 === range.c2 && range.r1 === range.r2) return;
    for (const m of this.merges) {
      if (overlaps(m, range)) throw new Error(`Merge ${JSON.stringify(range)} overlaps another`);
    }
    this.merges.push(range);
    if (style !== undefined) this.fill(range, style);
  }

  /** A solid in-cell data bar from 0 to the range's largest value. */
  dataBar(range: Range, color: string): void {
    this.priority += 1;
    this.rules.push({
      kind: 'dataBar',
      range,
      color,
      priority: this.priority,
      id: guid(this.priority),
    });
  }

  /** A formula rule (relative to the range's top-left cell) that applies a `dxf`. */
  expression(range: Range, formula: string, dxfId: number): void {
    this.priority += 1;
    this.rules.push({ kind: 'expression', range, formula, dxfId, priority: this.priority });
  }

  /** An internal link (`'Items'!A1`) on a cell that already holds its text. */
  link(col: number, row: number, location: string, display: string): void {
    this.links.push({ col, row, location, display });
  }

  setAutoFilter(range: Range): void {
    this.autoFilter = range;
  }

  setPrintTitleRows(from: number, to: number): void {
    this.printTitleRows = { from, to };
  }

  addChart(chart: ChartSpec): void {
    this.charts.push(chart);
  }

  /** Writes every row before `row` to XML; they cannot change afterwards. */
  flushBefore(row: number): void {
    const keys = [...this.pending.keys()].filter((r) => r < row).sort((a, b) => a - b);
    for (const r of keys) {
      const pending = this.pending.get(r)!;
      this.done.push(rowXml(r, pending));
      this.pending.delete(r);
    }
    if (row > this.flushedBefore) this.flushedBefore = row;
  }

  /** Defined names for the workbook (`localSheetId` is the sheet's position). */
  definedNames(sheetIndex: number): string[] {
    const out: string[] = [];
    const q = quoteSheet(this.name);
    if (this.autoFilter) {
      const a = this.autoFilter;
      const abs = absRange(a.c1, a.r1, a.c2, a.r2);
      out.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${sheetIndex}" hidden="1">${xmlEscape(`${q}!${abs}`)}</definedName>`,
      );
    }
    if (this.printTitleRows) {
      const { from, to } = this.printTitleRows;
      out.push(
        `<definedName name="_xlnm.Print_Titles" localSheetId="${sheetIndex}">${xmlEscape(`${q}!$${from}:$${to}`)}</definedName>`,
      );
    }
    return out;
  }

  /** The worksheet XML. `drawingRelId` is set when the package gave the sheet a drawing part. */
  xml(opts: { selected: boolean; drawingRelId?: string }): string {
    this.flushBefore(Number.MAX_SAFE_INTEGER);
    const o = this.options;
    const sheetPr =
      o.tabColor || o.fitToWidth
        ? '<sheetPr>' +
          (o.tabColor ? `<tabColor rgb="${argb(o.tabColor)}"/>` : '') +
          (o.fitToWidth ? '<pageSetUpPr fitToPage="1"/>' : '') +
          '</sheetPr>'
        : '';
    const dimension = `<dimension ref="${rangeRef(0, 1, this.maxCol, this.maxRow)}"/>`;
    const cols = [...this.widths]
      .sort((a, b) => a[0] - b[0])
      .map(
        ([c, w]) =>
          `<col min="${c + 1}" max="${c + 1}" width="${Math.round(w * 100) / 100}" customWidth="1"/>`,
      )
      .join('');

    const cf = this.rules
      .map((rule) => {
        const sq = rangeRef(rule.range.c1, rule.range.r1, rule.range.c2, rule.range.r2);
        if (rule.kind === 'expression') {
          return (
            `<conditionalFormatting sqref="${sq}"><cfRule type="expression" dxfId="${rule.dxfId}" priority="${rule.priority}">` +
            `<formula>${xmlEscape(rule.formula)}</formula></cfRule></conditionalFormatting>`
          );
        }
        return (
          `<conditionalFormatting sqref="${sq}"><cfRule type="dataBar" priority="${rule.priority}">` +
          `<dataBar><cfvo type="num" val="0"/><cfvo type="max"/><color rgb="${argb(rule.color)}"/></dataBar>` +
          `<extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="${NS_X14}"><x14:id>${rule.id}</x14:id></ext></extLst>` +
          '</cfRule></conditionalFormatting>'
        );
      })
      .join('');

    const bars = this.rules.filter((r): r is DataBarRule => r.kind === 'dataBar');
    const extLst =
      bars.length === 0
        ? ''
        : `<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="${NS_X14}"><x14:conditionalFormattings>` +
          bars
            .map(
              (rule) =>
                `<x14:conditionalFormatting xmlns:xm="${NS_XM}"><x14:cfRule type="dataBar" id="${rule.id}">` +
                '<x14:dataBar minLength="0" maxLength="100" border="0" gradient="0">' +
                '<x14:cfvo type="num"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="max"/>' +
                `<x14:negativeFillColor rgb="FFDF2F4A"/><x14:axisColor rgb="FF000000"/>` +
                '</x14:dataBar></x14:cfRule>' +
                `<xm:sqref>${rangeRef(rule.range.c1, rule.range.r1, rule.range.c2, rule.range.r2)}</xm:sqref>` +
                '</x14:conditionalFormatting>',
            )
            .join('') +
          '</x14:conditionalFormattings></ext></extLst>';

    const links =
      this.links.length === 0
        ? ''
        : '<hyperlinks>' +
          this.links
            .map(
              (l) =>
                `<hyperlink ref="${ref(l.col, l.row)}" location="${xmlEscape(l.location)}" display="${xmlEscape(l.display)}"/>`,
            )
            .join('') +
          '</hyperlinks>';

    const merges =
      this.merges.length === 0
        ? ''
        : `<mergeCells count="${this.merges.length}">` +
          this.merges
            .map((m) => `<mergeCell ref="${rangeRef(m.c1, m.r1, m.c2, m.r2)}"/>`)
            .join('') +
          '</mergeCells>';

    const af = this.autoFilter
      ? `<autoFilter ref="${rangeRef(this.autoFilter.c1, this.autoFilter.r1, this.autoFilter.c2, this.autoFilter.r2)}"/>`
      : '';

    return (
      XML_HEADER +
      `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      sheetPr +
      dimension +
      sheetViewXml(o, opts.selected) +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (cols ? `<cols>${cols}</cols>` : '') +
      `<sheetData>${this.done.join('')}</sheetData>` +
      af +
      merges +
      cf +
      links +
      '<printOptions horizontalCentered="1"/>' +
      '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      `<pageSetup orientation="${o.landscape ? 'landscape' : 'portrait'}"${o.fitToWidth ? ' fitToWidth="1" fitToHeight="0"' : ''}/>` +
      (opts.drawingRelId ? `<drawing r:id="${opts.drawingRelId}"/>` : '') +
      extLst +
      '</worksheet>'
    );
  }
}

function rowXml(r: number, row: PendingRow): string {
  const cells = [...row.cells].sort((a, b) => a[0] - b[0]).map(([, xml]) => xml);
  const ht = row.height !== undefined ? ` ht="${row.height}" customHeight="1"` : '';
  if (cells.length === 0 && ht === '') return '';
  return `<row r="${r}"${ht}>${cells.join('')}</row>`;
}

function sheetViewXml(o: SheetOptions, selected: boolean): string {
  const attrs =
    (o.showGridLines === false ? ' showGridLines="0"' : '') + (selected ? ' tabSelected="1"' : '');
  const freeze = o.freeze;
  if (!freeze || (freeze.cols === 0 && freeze.rows === 0)) {
    return `<sheetViews><sheetView${attrs} workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>`;
  }
  const { cols, rows } = freeze;
  const topLeft = ref(cols, rows + 1);
  let pane: string;
  let selection: string;
  if (cols > 0 && rows > 0) {
    pane = `<pane xSplit="${cols}" ySplit="${rows}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/>`;
    selection =
      `<selection pane="topRight" activeCell="${ref(cols, 1)}" sqref="${ref(cols, 1)}"/>` +
      `<selection pane="bottomLeft" activeCell="${ref(0, rows + 1)}" sqref="${ref(0, rows + 1)}"/>` +
      `<selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/>`;
  } else if (rows > 0) {
    pane = `<pane ySplit="${rows}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/>`;
    selection = `<selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/>`;
  } else {
    pane = `<pane xSplit="${cols}" topLeftCell="${topLeft}" activePane="topRight" state="frozen"/>`;
    selection = `<selection pane="topRight" activeCell="${topLeft}" sqref="${topLeft}"/>`;
  }
  return `<sheetViews><sheetView${attrs} workbookViewId="0">${pane}${selection}</sheetView></sheetViews>`;
}
