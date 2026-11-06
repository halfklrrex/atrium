/** Pure CSV helpers (RFC 4180) for "Export to CSV". No DOM, no Firebase. */

/** UTF-8 byte order mark: prepended to the file so Excel reads accents correctly. */
export const CSV_BOM = '﻿';

/** First characters that make a spreadsheet read a text field as a formula (OWASP guidance). */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
/** A plain number such as `-5` or `-12.50`; the only text the formula guard lets through. */
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

/** A cell of a CSV row: plain text, or text from a numeric cell (negative numbers stay numbers). */
export type CsvCell = string | { text: string; numeric: true };

/**
 * One CSV field: formula-guarded, then quoted when it holds `"`, `,`, CR or LF (`"` doubled).
 * `numeric` marks text that came from a numeric cell: a plain negative number is then exported
 * as is instead of getting the leading quote.
 */
export function csvEscapeField(text: string, options: { numeric?: boolean } = {}): string {
  let field = text;
  if (FORMULA_PREFIX.test(field) && !(options.numeric === true && PLAIN_NUMBER.test(field))) {
    field = `'${field}`;
  }
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** Escapes every cell and joins the rows with `\r\n` (no BOM, no trailing newline). */
export function buildCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          typeof cell === 'string'
            ? csvEscapeField(cell)
            : csvEscapeField(cell.text, { numeric: true }),
        )
        .join(','),
    )
    .join('\r\n');
}

const MAX_FILE_NAME = 80;

/** `<board name>.csv` with characters not allowed in file names replaced by `-`. */
export function csvFileName(boardName: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
  const cleaned = boardName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
  const base = cleaned.slice(0, MAX_FILE_NAME).trim();
  return `${base || 'board'}.csv`;
}
