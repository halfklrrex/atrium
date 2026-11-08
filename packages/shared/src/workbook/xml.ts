/** XML text helpers and cell references for the workbook writer. Pure. */

export const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Excel's limit for the text of one cell; a longer cell makes the file corrupt. */
export const MAX_CELL_TEXT = 32_767;

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

/** Cuts text to Excel's cell limit without splitting a surrogate pair. */
export function clampCellText(text: string): string {
  if (text.length <= MAX_CELL_TEXT) return text;
  let cut = MAX_CELL_TEXT;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return text.slice(0, cut);
}

/** Column letters for a zero-based index: 0 -> A, 26 -> AA. */
export function xlsxColumnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/** `A1` reference of a zero-based column and a one-based row. */
export const cellRef = (col: number, row: number): string => `${xlsxColumnName(col)}${row}`;

/** `A1:C3` (or `A1` when the range is one cell). */
export function rangeRef(col1: number, row1: number, col2: number, row2: number): string {
  const a = cellRef(col1, row1);
  const b = cellRef(col2, row2);
  return a === b ? a : `${a}:${b}`;
}

/** `$A$1:$C$3`, for chart series and defined names. */
export function absRange(col1: number, row1: number, col2: number, row2: number): string {
  const abs = (c: number, r: number) => `$${xlsxColumnName(c)}$${r}`;
  return `${abs(col1, row1)}:${abs(col2, row2)}`;
}

/** A sheet name quoted for a formula or reference: `'Items'`, with `'` doubled. */
export const quoteSheet = (name: string): string => `'${name.replace(/'/g, "''")}'`;

/** `true` when a text needs `xml:space="preserve"` to keep its spaces and line breaks. */
export const needsPreserve = (text: string): boolean => /^\s|\s$|\n/.test(text);
