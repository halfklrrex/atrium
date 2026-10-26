/**
 * Colour palettes whose hex values are stored in Firestore documents (workspaces, folders, groups),
 * so they must be literal `#rrggbb` strings. Each entry mirrors a Vibe `--color-*` token (checked by
 * `palette.test.ts`); this file is the single place those literals live, next to `tokens.css`.
 */

export interface PaletteColor {
  /** Vibe token name without the `--color-` prefix. */
  name: string;
  label: string;
  hex: string;
}

/** The 10 colours offered for workspace and folder avatars. */
export const WORKSPACE_COLORS: readonly PaletteColor[] = [
  { name: 'indigo', label: 'Indigo', hex: '#5559df' },
  { name: 'bright-blue', label: 'Blue', hex: '#579bfc' },
  { name: 'aquamarine', label: 'Aquamarine', hex: '#4eccc6' },
  { name: 'done-green', label: 'Green', hex: '#00c875' },
  { name: 'lime-green', label: 'Lime', hex: '#9cd326' },
  { name: 'egg_yolk', label: 'Yellow', hex: '#ffcb00' },
  { name: 'working_orange', label: 'Orange', hex: '#fdab3d' },
  { name: 'stuck-red', label: 'Red', hex: '#df2f4a' },
  { name: 'lipstick', label: 'Pink', hex: '#ff5ac4' },
  { name: 'purple', label: 'Purple', hex: '#9d50dd' },
];

export const DEFAULT_WORKSPACE_COLOR = WORKSPACE_COLORS[0]!.hex;
export const DEFAULT_FOLDER_COLOR = WORKSPACE_COLORS[1]!.hex;

/** Colour of a folder icon in the sidebar when the stored value is not a known palette colour. */
export function colorLabel(hex: string): string {
  return WORKSPACE_COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.label ?? hex;
}

/** monday's 20 group colours (the "Change group colour" palette), in monday's order. */
export const GROUP_COLORS: readonly PaletteColor[] = [
  { name: 'grass_green', label: 'Grass green', hex: '#037f4c' },
  { name: 'done-green', label: 'Green', hex: '#00c875' },
  { name: 'bright-green', label: 'Lime green', hex: '#9cd326' },
  { name: 'saladish', label: 'Saladish', hex: '#cab641' },
  { name: 'egg_yolk', label: 'Yellow', hex: '#ffcb00' },
  { name: 'working_orange', label: 'Orange', hex: '#fdab3d' },
  { name: 'dark-orange', label: 'Dark orange', hex: '#ff6d3b' },
  { name: 'peach', label: 'Peach', hex: '#ffadad' },
  { name: 'sunset', label: 'Sunset', hex: '#ff7575' },
  { name: 'stuck-red', label: 'Red', hex: '#df2f4a' },
  { name: 'dark-red', label: 'Dark red', hex: '#bb3354' },
  { name: 'sofia_pink', label: 'Dark pink', hex: '#e50073' },
  { name: 'lipstick', label: 'Pink', hex: '#ff5ac4' },
  { name: 'bubble', label: 'Bubble', hex: '#faa1f1' },
  { name: 'purple', label: 'Purple', hex: '#9d50dd' },
  { name: 'dark_purple', label: 'Dark purple', hex: '#784bd1' },
  { name: 'indigo', label: 'Indigo', hex: '#5559df' },
  { name: 'bright-blue', label: 'Blue', hex: '#579bfc' },
  { name: 'chili-blue', label: 'Light blue', hex: '#66ccff' },
  { name: 'aquamarine', label: 'Aquamarine', hex: '#4eccc6' },
];

/** Colours offered for status labels: the group palette plus monday's greys and brown. */
export const STATUS_LABEL_COLORS: readonly PaletteColor[] = [
  ...GROUP_COLORS,
  { name: 'brown', label: 'Brown', hex: '#7f5347' },
  { name: 'american_gray', label: 'Dark grey', hex: '#757575' },
  { name: 'explosive', label: 'Grey', hex: '#c4c4c4' },
];

/** The next group colour for a new group: the first palette colour not in use yet. */
export function nextGroupColor(used: readonly string[]): string {
  const taken = new Set(used.map((hex) => hex.toLowerCase()));
  const free = GROUP_COLORS.find((c) => !taken.has(c.hex.toLowerCase()));
  return (free ?? GROUP_COLORS[used.length % GROUP_COLORS.length]!).hex;
}
