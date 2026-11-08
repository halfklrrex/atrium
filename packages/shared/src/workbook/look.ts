/** The workbook's shared look: named styles, the banner/subtitle/stripe header and the subtitle text. */
import type { BoardWorkbookData } from './board-workbook';
import { PALETTE, textOn } from './palette';
import type { SheetWriter } from './sheet';
import { StyleRegistry, type BorderSide } from './styles';
import { quoteSheet } from './xml';

export const SUMMARY_SHEET = 'Summary';
/** Default height of a table row, in points. */
export const ROW_H = 20;

export const thin = (color: string): BorderSide => ({ style: 'thin', color });
export const medium = (color: string): BorderSide => ({ style: 'medium', color });

export class Look {
  readonly st = new StyleRegistry();
  readonly banner = this.st.style({
    font: { size: 20, bold: true, color: PALETTE.white },
    fill: PALETTE.brand,
    align: { h: 'left', v: 'center', indent: 1 },
  });
  readonly subtitle = this.st.style({
    font: { size: 10, color: PALETTE.brandTint },
    fill: PALETTE.brandDark,
    align: { h: 'left', v: 'center', indent: 1 },
  });
  readonly subtitleLink = this.st.style({
    font: { size: 10, bold: true, underline: true, color: PALETTE.white },
    fill: PALETTE.brandDark,
    align: { h: 'right', v: 'center', indent: 1 },
  });
  readonly section = this.st.style({
    font: { size: 11, bold: true, color: PALETTE.brand },
    border: { bottom: medium(PALETTE.brand) },
    align: { h: 'left', v: 'bottom' },
  });
  readonly th = this.st.style({
    font: { bold: true },
    fill: PALETTE.brandTint,
    border: { bottom: thin(PALETTE.brand) },
    align: { h: 'left', v: 'center', wrap: true, indent: 1 },
  });
  readonly thRight = this.st.style({
    font: { bold: true },
    fill: PALETTE.brandTint,
    border: { bottom: thin(PALETTE.brand) },
    align: { h: 'right', v: 'center', wrap: true, indent: 1 },
  });
  readonly td = this.st.style({
    border: { bottom: thin(PALETTE.rule) },
    align: { h: 'left', v: 'center', indent: 1 },
  });
  readonly tdCount = this.st.style({
    border: { bottom: thin(PALETTE.rule) },
    numFmt: '#,##0',
    align: { h: 'right', v: 'center', indent: 1 },
  });
  readonly tdShare = this.st.style({
    font: { color: PALETTE.textMuted },
    border: { bottom: thin(PALETTE.rule) },
    numFmt: '0%',
    align: { h: 'right', v: 'center', indent: 1 },
  });
  readonly totalLabel = this.st.style({
    font: { bold: true },
    border: { top: thin(PALETTE.text) },
    align: { h: 'left', v: 'center', indent: 1 },
  });
  readonly totalCount = this.st.style({
    font: { bold: true },
    border: { top: thin(PALETTE.text) },
    numFmt: '#,##0',
    align: { h: 'right', v: 'center', indent: 1 },
  });
  readonly totalShare = this.st.style({
    font: { bold: true },
    border: { top: thin(PALETTE.text) },
    numFmt: '0%',
    align: { h: 'right', v: 'center', indent: 1 },
  });
  readonly link = this.st.style({
    font: { underline: true, color: PALETTE.brand, bold: true },
    border: { bottom: thin(PALETTE.rule) },
    align: { h: 'left', v: 'center', indent: 1 },
  });
  readonly linkNote = this.st.style({
    font: { color: PALETTE.textMuted },
    border: { bottom: thin(PALETTE.rule) },
    align: { h: 'left', v: 'center', wrap: true, indent: 1 },
  });
  readonly note = this.st.style({
    font: { size: 9, italic: true, color: PALETTE.textMuted },
    align: { h: 'left', v: 'center', wrap: true },
  });

  /** A label cell in the label's own colour (status, priority, group). */
  labelCell(color: string | null): number {
    const fill = color ?? PALETTE.empty;
    return this.st.style({
      font: { color: textOn(fill) },
      fill,
      border: { bottom: thin(PALETTE.white), top: thin(PALETTE.white) },
      align: { h: 'center', v: 'center', wrap: true },
    });
  }

  fillOnly(color: string): number {
    return this.st.style({ fill: color });
  }
}

/** Banner, subtitle and colour stripe in rows 1 to 3 over columns 0..lastCol. */
export function header(
  sheet: SheetWriter,
  look: Look,
  data: Pick<BoardWorkbookData, 'boardName' | 'stripe'>,
  lastCol: number,
  subtitle: string,
  backLink: boolean,
): void {
  sheet.setHeight(1, 42);
  sheet.setHeight(2, 22);
  sheet.setHeight(3, 4);
  sheet.text(0, 1, data.boardName || 'Board', look.banner);
  sheet.merge({ c1: 0, r1: 1, c2: lastCol, r2: 1 }, look.banner);
  const subEnd = backLink && lastCol >= 2 ? lastCol - 1 : lastCol;
  sheet.text(0, 2, subtitle, look.subtitle);
  sheet.merge({ c1: 0, r1: 2, c2: subEnd, r2: 2 }, look.subtitle);
  if (subEnd < lastCol) {
    sheet.text(lastCol, 2, '‹ Summary', look.subtitleLink);
    sheet.link(lastCol, 2, `${quoteSheet(SUMMARY_SHEET)}!A1`, 'Summary');
  }
  const colors = data.stripe.length > 0 ? data.stripe : [PALETTE.brand];
  for (let c = 0; c <= lastCol; c += 1) {
    sheet.blank(c, 3, look.fillOnly(colors[c % colors.length] as string));
  }
}

export function subtitleText(data: BoardWorkbookData, what: string): string {
  const n = data.selection ? data.selection.count : data.figures.items;
  const scope = data.selection
    ? `Selection of ${n} ${n === 1 ? 'item' : 'items'} (of ${data.selection.total} on the board)`
    : `${n} ${n === 1 ? 'item' : 'items'}`;
  return `${what} · ${scope} · Exported ${data.exportedLabel}`;
}
