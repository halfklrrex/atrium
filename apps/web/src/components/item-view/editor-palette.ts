/**
 * The description's colour palette and font set, by KEY. The stored doc holds these keys only
 * (never a hex value or a font stack); theme/editor-tokens.css maps each key to tokens, so dark
 * mode and later palette tweaks apply to old content too.
 */

export const COLOR_KEYS = [
  'grey',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'brown',
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_LABELS: Record<ColorKey, string> = {
  grey: 'Grey',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  brown: 'Brown',
};

export function isColorKey(value: unknown): value is ColorKey {
  return typeof value === 'string' && (COLOR_KEYS as readonly string[]).includes(value);
}

/** The highlight used when a highlight has no (valid) key: a pasted `<mark>`, `==text==`. */
export const DEFAULT_HIGHLIGHT: ColorKey = 'yellow';

export interface FontDefinition {
  key: string;
  label: string;
}

/** `default` is the absence of a font mark. */
export const FONTS: readonly FontDefinition[] = [
  { key: 'default', label: 'Default' },
  { key: 'figtree', label: 'Figtree' },
  { key: 'poppins', label: 'Poppins' },
  { key: 'lora', label: 'Lora' },
  { key: 'nunito', label: 'Nunito' },
  { key: 'mono', label: 'JetBrains Mono' },
  { key: 'caveat', label: 'Caveat' },
];

/** The keys a doc can carry (everything but `default`). */
export const FONT_KEYS = FONTS.filter((f) => f.key !== 'default').map((f) => f.key);

export function isFontKey(value: unknown): value is string {
  return typeof value === 'string' && FONT_KEYS.includes(value);
}
