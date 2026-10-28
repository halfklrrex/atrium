export interface FitItem {
  id: string;
  /** The tool's outer width in px, including the gap after it. */
  width: number;
}

/**
 * The order the description toolbar gives tools up when the row is too narrow: first to go is the
 * Image button, last is Bold. More and Expand are never hidden, so they are not listed.
 */
export const TOOL_HIDE_ORDER = [
  'image',
  'emoji',
  'font',
  'undo',
  'redo',
  'link',
  'color',
  'tasks',
  'numbers',
  'bullets',
  'strike',
  'underline',
  'style',
  'italic',
  'bold',
] as const;

/**
 * Which of the hideable tools stay in the row. `available` is the width left for them after the
 * fixed parts (More, Expand, separators, padding). Tools are removed in `hideOrder` until the rest
 * fit; ids missing from `hideOrder` are never removed.
 */
export function toolsThatFit(
  items: readonly FitItem[],
  available: number,
  hideOrder: readonly string[] = TOOL_HIDE_ORDER,
): Set<string> {
  const widths = new Map(items.map((item) => [item.id, item.width]));
  const visible = new Set(widths.keys());
  let total = items.reduce((sum, item) => sum + item.width, 0);
  for (const id of hideOrder) {
    if (total <= available) break;
    if (!visible.has(id)) continue;
    visible.delete(id);
    total -= widths.get(id) ?? 0;
  }
  return visible;
}
