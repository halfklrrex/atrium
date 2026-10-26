/**
 * Position maths for moving and inserting items and groups. Everything works on lists that are
 * already in position order and returns fractional-indexing keys (`lib/positions`).
 */
import {
  comparePositions,
  positionAfterAll,
  positionAtIndex,
  positionBetween,
  type Positioned,
} from '../../lib/positions';

/**
 * Key for dropping `movingId` at `index` among `siblings` (0-based, counted without the moving
 * item itself). `siblings` may still contain the moving item; it is ignored.
 */
export function dropPosition(
  siblings: readonly Positioned[],
  movingId: string,
  index: number,
): string {
  const others = siblings.filter((s) => s.id !== movingId).sort(comparePositions);
  return positionAtIndex(others, index);
}

/** Index of `overId` among `siblings` once `movingId` is taken out; `-1` when it is not there. */
export function indexWithout(
  siblings: readonly Positioned[],
  movingId: string,
  overId: string,
): number {
  return siblings.filter((s) => s.id !== movingId).findIndex((s) => s.id === overId);
}

/** `count` increasing keys that all sort after every key in `existing`. */
export function appendPositions(existing: readonly Positioned[], count: number): string[] {
  const keys: string[] = [];
  let last = positionAfterAll(existing);
  for (let i = 0; i < count; i++) {
    keys.push(last);
    last = positionBetween(last, null);
  }
  return keys;
}

/**
 * Keys that put one new entry right after each of `afterIds` (duplicate items next to their
 * originals). Returned in the same order as `afterIds`; several copies of neighbouring items keep
 * their relative order.
 */
export function positionsAfter(
  siblings: readonly Positioned[],
  afterIds: readonly string[],
): string[] {
  const sorted = [...siblings].sort(comparePositions);
  const taken = new Set<string>();
  return afterIds.map((id) => {
    const at = sorted.findIndex((s) => s.id === id);
    if (at === -1) {
      const key = positionAfterAll(sorted);
      sorted.push({ id: `__new${taken.size}`, position: key });
      taken.add(key);
      return key;
    }
    const key = positionBetween(sorted[at]!.position, sorted[at + 1]?.position ?? null);
    sorted.splice(at + 1, 0, { id: `__new${taken.size}`, position: key });
    taken.add(key);
    return key;
  });
}
