import { STATUS_LABEL_COLORS } from '../theme/palette';

export interface Hsv {
  /** Hue in degrees, 0 to 360. */
  h: number;
  /** Saturation, 0 to 100. */
  s: number;
  /** Value (brightness), 0 to 100. */
  v: number;
}

/**
 * Parses `#RRGGBB`, `RRGGBB` or the 3-digit shorthand into a lowercase `#rrggbb`, or `null` when
 * the text is not a color.
 */
export function normalizeHex(input: string): string | null {
  const clean = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) return `#${clean}`.toLowerCase();
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const f = (n: number) => {
    const k = (n + hue / 60) % 6;
    return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const part = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(f(5))}${part(f(3))}${part(f(1))}`;
}

export function hexToHsv(hex: string): Hsv {
  const full = normalizeHex(hex) ?? '#000000';
  const r = Number.parseInt(full.slice(1, 3), 16) / 255;
  const g = Number.parseInt(full.slice(3, 5), 16) / 255;
  const b = Number.parseInt(full.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : (delta / max) * 100, v: max * 100 };
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a hex color (0 for anything that is not a color). */
export function relativeLuminance(hex: string): number {
  const full = normalizeHex(hex);
  if (!full) return 0;
  const r = Number.parseInt(full.slice(1, 3), 16);
  const g = Number.parseInt(full.slice(3, 5), 16);
  const b = Number.parseInt(full.slice(5, 7), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * The readable text token for a fill: dark on bright colors, white on dark ones. Palette colors
 * keep their white label (monday's look); only light custom colors flip to dark.
 */
export function getReadableTextColor(
  hex: string,
): 'var(--fixed-dark-color)' | 'var(--atrium-table-on-fill)' {
  return relativeLuminance(hex) > 0.5 ? 'var(--fixed-dark-color)' : 'var(--atrium-table-on-fill)';
}

const PALETTE_HEXES = new Set(STATUS_LABEL_COLORS.map((c) => c.hex.toLowerCase()));

export function isPaletteColor(hex: string): boolean {
  return PALETTE_HEXES.has(hex.toLowerCase());
}

/**
 * The custom (non-palette) colors the given column settings already use, deduplicated in first-use
 * order, so they can be offered again. Nothing is stored for this: it is derived from the labels.
 */
export function customLabelColors(settingsList: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const settings of settingsList) {
    const labels = (settings as { labels?: unknown } | null | undefined)?.labels;
    if (!Array.isArray(labels)) continue;
    for (const label of labels) {
      const color = (label as { color?: unknown } | null)?.color;
      if (typeof color !== 'string') continue;
      const hex = normalizeHex(color);
      if (!hex || isPaletteColor(hex) || seen.has(hex)) continue;
      seen.add(hex);
      result.push(hex);
    }
  }
  return result;
}
