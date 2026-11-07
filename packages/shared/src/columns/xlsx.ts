/**
 * Pure builder for the parts of a minimal `.xlsx` workbook (one sheet, "Items"). No DOM, no zip
 * library: it returns a map of part name to XML text, and the web app zips the parts with `fflate`.
 */
import type { CsvCell } from './csv';

/** Longest column width, in characters. */
export const XLSX_MAX_COLUMN_WIDTH = 60;
export const XLSX_SHEET_NAME = 'Items';

/** Same first characters the CSV guard stops (OWASP formula-injection guidance). */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Style indexes of `xl/styles.xml`: 0 normal, 1 bold header, 2 date, 3 date and time. */
const STYLE_HEADER = 1;
const STYLE_DATE = 2;
const STYLE_DATE_TIME = 3;

/** Removes characters XML 1.0 cannot hold (control characters, lone surrogates, U+FFFE/FFFF). */
export function stripIllegalXmlChars(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- the point is to remove control characters
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
      .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
  );
}

/** Escapes text for an XML text node or attribute value, after removing illegal characters. */
export function xmlEscape(text: string): string {
  return stripIllegalXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Column letters for a zero-based index: 0 -> A, 26 -> AA. */
export function xlsxColumnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/**
 * Excel serial number of a `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS` text (1900 date system), or
 * `null` when the text is not a real date. Days since 1899-12-30; the fraction is the time.
 */
export function excelSerialDate(text: string): { serial: number; hasTime: boolean } | null {
  const full = DATE_TIME.exec(text);
  const dateOnly = DATE_ONLY.exec(text);
  const match = full ?? dateOnly;
  if (!match) return null;
  const [y, m, d, hh = 0, mm = 0, ss = 0] = match.slice(1).map(Number) as number[];
  const ms = Date.UTC(y as number, (m as number) - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== (m as number) - 1) return null;
  if (check.getUTCDate() !== d) return null;
  const days = (ms - Date.UTC(1899, 11, 30)) / 86_400_000;
  return { serial: days + (hh * 3600 + mm * 60 + ss) / 86_400, hasTime: full !== null };
}

interface SheetCell {
  /** The `<c>` element (empty for a blank cell). */
  xml: string;
  /** Characters the cell adds to the width estimate. */
  width: number;
}

const stringCell = (ref: string, text: string, style = 0): string => {
  const safe = stripIllegalXmlChars(text);
  const s = style === 0 ? '' : ` s="${style}"`;
  if (safe === '') return '';
  const space = /^\s|\s$|\n/.test(safe) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t${space}>${xmlEscape(safe)}</t></is></c>`;
};

const numberCell = (ref: string, value: number, style = 0): string =>
  `<c r="${ref}"${style === 0 ? '' : ` s="${style}"`}><v>${String(value)}</v></c>`;

/** Formula guard: a string cell the sheet could read as a formula gets a leading `'`. */
function guarded(text: string): string {
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function buildCell(ref: string, cell: CsvCell, isHeader: boolean): SheetCell {
  if (isHeader) {
    const text = typeof cell === 'string' ? cell : cell.text;
    return { xml: stringCell(ref, guarded(text), STYLE_HEADER), width: text.length };
  }
  if (typeof cell === 'string') {
    const text = guarded(cell);
    return { xml: stringCell(ref, text), width: longestLine(text) };
  }
  if ('numeric' in cell) {
    const n = PLAIN_NUMBER.test(cell.text) ? Number(cell.text) : Number.NaN;
    if (Number.isFinite(n)) return { xml: numberCell(ref, n), width: cell.text.length };
    const text = guarded(cell.text);
    return { xml: stringCell(ref, text), width: text.length };
  }
  if ('date' in cell) {
    const date = excelSerialDate(cell.text);
    if (date) {
      const style = date.hasTime ? STYLE_DATE_TIME : STYLE_DATE;
      return { xml: numberCell(ref, date.serial, style), width: cell.text.length };
    }
    const text = guarded(cell.text);
    return { xml: stringCell(ref, text), width: text.length };
  }
  // checkbox: the CSV text is empty when unticked
  const text = cell.text === '' ? 'FALSE' : 'TRUE';
  return { xml: stringCell(ref, text), width: text.length };
}

const longestLine = (text: string): number =>
  text.split(/\r\n|\r|\n/).reduce((max, line) => Math.max(max, line.length), 0);

/** `xl/worksheets/sheet1.xml`: frozen bold header row, widths from the longest cell. */
export function buildSheetXml(rows: readonly (readonly CsvCell[])[]): string {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const widths = new Array<number>(columnCount).fill(0);
  const rowXml: string[] = [];
  rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((cell, c) => {
      const built = buildCell(`${xlsxColumnName(c)}${r + 1}`, cell, r === 0);
      widths[c] = Math.max(widths[c] ?? 0, built.width);
      cells.push(built.xml);
    });
    rowXml.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  });

  const cols = widths
    .map((w, i) => {
      const width = Math.min(XLSX_MAX_COLUMN_WIDTH, Math.max(8, w + 2));
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');
  const lastRef = `${xlsxColumnName(Math.max(columnCount, 1) - 1)}${Math.max(rows.length, 1)}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${lastRef}"/>` +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${rowXml.join('')}</sheetData>` +
    '</worksheet>'
  );
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const CONTENT_TYPES =
  XML_HEADER +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS =
  XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const WORKBOOK =
  XML_HEADER +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  `<sheets><sheet name="${XLSX_SHEET_NAME}" sheetId="1" r:id="rId1"/></sheets>` +
  '</workbook>';

const WORKBOOK_RELS =
  XML_HEADER +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

// cellXfs: 0 normal, 1 bold header, 2 date (numFmt 14 = built-in short date), 3 date and time.
const STYLES =
  XML_HEADER +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts>' +
  '<fonts count="2">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/**
 * The parts of the workbook, keyed by their path inside the zip. Rows come from the same builder
 * as the CSV (header first). The caller zips the values (UTF-8) in this order.
 */
export function buildXlsxParts(rows: readonly (readonly CsvCell[])[]): Record<string, string> {
  return {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': ROOT_RELS,
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': WORKBOOK_RELS,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': buildSheetXml(rows),
  };
}
