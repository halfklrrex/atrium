import { positionAtIndex, type Positioned } from './positions';

/**
 * The key for moving favourite `boardId` so it lands at `targetIndex` (0-based) in the list of
 * *visible* favourites without it. `favorites` is the full list sorted by position: favourites
 * for boards the user can't see (or that are archived) are hidden in the UI but still occupy
 * positions, so the neighbours come from the full list. `visibleIds` is the visible order.
 */
export function favoritePositionFor(
  favorites: readonly (Positioned & { boardId: string })[],
  visibleIds: readonly string[],
  boardId: string,
  targetIndex: number,
): string {
  const fullWithout = favorites.filter((f) => f.boardId !== boardId);
  const visibleWithout = visibleIds.filter((id) => id !== boardId);
  if (targetIndex <= 0) return positionAtIndex(fullWithout, 0);
  if (targetIndex >= visibleWithout.length) return positionAtIndex(fullWithout, fullWithout.length);
  const anchor = visibleWithout[targetIndex - 1];
  const anchorIndex = fullWithout.findIndex((f) => f.boardId === anchor);
  return positionAtIndex(fullWithout, anchorIndex < 0 ? fullWithout.length : anchorIndex + 1);
}

/** `ids` with `id` moved to `index` (clamped). */
export function moveId(ids: readonly string[], id: string, index: number): string[] {
  const rest = ids.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, id);
  return rest;
}
