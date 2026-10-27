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
  /** The Google Fonts family name, or null when the font is already loaded by index.html. */
  family: string | null;
  /** Weights to request when the family is loaded on demand. */
  weights: string;
  /** Whether the family has italics (the `ital` axis). */
  italics: boolean;
}

/** `default` is the absence of a font mark. */
export const FONTS: readonly FontDefinition[] = [
  { key: 'default', label: 'Default', family: null, weights: '', italics: false },
  { key: 'figtree', label: 'Figtree', family: null, weights: '', italics: false },
  { key: 'poppins', label: 'Poppins', family: 'Poppins', weights: '400;700', italics: true },
  { key: 'lora', label: 'Lora', family: 'Lora', weights: '400;700', italics: true },
  { key: 'nunito', label: 'Nunito', family: 'Nunito', weights: '400;700', italics: true },
  {
    key: 'mono',
    label: 'JetBrains Mono',
    family: 'JetBrains Mono',
    weights: '400;700',
    italics: true,
  },
  { key: 'caveat', label: 'Caveat', family: 'Caveat', weights: '400;700', italics: false },
];

/** The keys a doc can carry (everything but `default`). */
export const FONT_KEYS = FONTS.filter((f) => f.key !== 'default').map((f) => f.key);

export function isFontKey(value: unknown): value is string {
  return typeof value === 'string' && FONT_KEYS.includes(value);
}
