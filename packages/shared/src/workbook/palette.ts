/**
 * Atrium's colours and font for the Excel workbook. A workbook cannot read CSS variables, so the
 * values are written here as literals; each one names the Vibe token (`@vibe/core`
 * `dist/tokens/tokens.css`, light theme) or the Atrium token it copies.
 */

export const PALETTE = {
  /** Vibe `--primary-color`: Atrium's brand blue. */
  brand: '#0073EA',
  /** Vibe `--primary-hover-color`. */
  brandDark: '#0060B9',
  /** Vibe `--primary-selected-color`: header fills and the subtitle text. */
  brandTint: '#CCE5FF',
  /** Vibe `--color-bright-blue`: data bars. */
  bar: '#579BFC',
  /** Vibe `--primary-text-color`. */
  text: '#323338',
  /** Vibe `--secondary-text-color`. */
  textMuted: '#676879',
  /** Atrium `--atrium-white`. */
  white: '#FFFFFF',
  /** Vibe `--allgrey-background-color`: banding and card backgrounds. */
  band: '#F6F7FB',
  /** Vibe `--ui-background-color`: row separators. */
  rule: '#E7E9EF',
  /** Vibe `--layout-border-color`: card frames. */
  frame: '#D0D4E4',
  /** Vibe `--color-done-green`. */
  done: '#00C875',
  /** Vibe `--color-stuck-red`. */
  stuck: '#DF2F4A',
  /** Vibe `--color-purple`: view sheet tabs. */
  purple: '#9D50DD',
  /** monday's grey for a cell without a status (`EMPTY_STATUS_COLOR`). */
  empty: '#C4C4C4',
} as const;

/** Every text in the workbook. Excel substitutes a sans-serif (family 2) when it is missing. */
export const WORKBOOK_FONT = 'Figtree';

/** `#0073ea` -> `FF0073EA` (ARGB, as SpreadsheetML wants). Invalid input becomes black. */
export function argb(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return `FF${(m?.[1] ?? '000000').toUpperCase()}`;
}

/** `#0073ea` -> `0073EA` (DrawingML `srgbClr`). */
export const rgb = (hex: string): string => argb(hex).slice(2);

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#RRGGBB` colour (0 black to 1 white). */
export function luminance(hex: string): number {
  const h = rgb(hex);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Text colour for a cell filled with `hex`: white, as the table's status cells
 * (`--atrium-table-on-fill`), except on a very light fill (a custom pale label) where white
 * would vanish.
 */
export function textOn(hex: string): string {
  return luminance(hex) > 0.7 ? PALETTE.text : PALETTE.white;
}
