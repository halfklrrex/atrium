/** Which view tabs fit in a row; the rest go behind the "More" menu. */

export interface TabFitInput {
  /** View ids in display order. */
  ids: readonly string[];
  /** Measured width of each tab, by id. */
  widths: ReadonlyMap<string, number>;
  /** Width the tab row may use. */
  available: number;
  /** Width of the "N more" trigger (reserved whenever something is hidden). */
  moreWidth: number;
  /** Gap between neighbouring tabs. */
  gap: number;
  /** The selected view: always kept visible. */
  activeId: string;
}

/**
 * Ids of the tabs to show, in display order. Everything is shown when it all fits. Otherwise tabs
 * are taken from the left while they fit next to the "More" trigger, and the selected view is
 * swapped in (dropping tabs from the end) if it would have been hidden.
 */
export function fitVisibleTabs({
  ids,
  widths,
  available,
  moreWidth,
  gap,
  activeId,
}: TabFitInput): string[] {
  const width = (id: string) => widths.get(id) ?? 0;
  const total = ids.reduce((sum, id, i) => sum + width(id) + (i > 0 ? gap : 0), 0);
  if (total <= available) return [...ids];

  const budget = available - moreWidth - gap;
  const picked: string[] = [];
  let used = 0;
  for (const id of ids) {
    const next = used + width(id) + (picked.length > 0 ? gap : 0);
    if (next > budget) break;
    picked.push(id);
    used = next;
  }
  if (picked.includes(activeId) || !ids.includes(activeId)) {
    return picked.length > 0 ? picked : ids.slice(0, 1);
  }

  // The selected view did not fit: drop tabs from the end until it does, then restore the order.
  const rest = [...picked];
  const usedBy = (list: string[]) =>
    list.reduce((sum, id, i) => sum + width(id) + (i > 0 ? gap : 0), 0);
  while (rest.length > 0 && usedBy(rest) + gap + width(activeId) > budget) rest.pop();
  const keep = new Set([...rest, activeId]);
  return ids.filter((id) => keep.has(id));
}
