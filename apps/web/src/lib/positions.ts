import { generateKeyBetween } from 'fractional-indexing';

/** Anything ordered by a fractional-indexing `position` key. */
export interface Positioned {
  id: string;
  position: string;
}

/**
 * Fractional-indexing keys sort by plain code-unit order (never `localeCompare`). Ties break on id
 * so the order is stable when two documents ended up with the same key.
 */
export function comparePositions(a: Positioned, b: Positioned): number {
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A key that sorts strictly between `before` and `after`; `null` means "no neighbour on that side". */
export function positionBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before, after);
  } catch {
    // Neighbours with equal or inverted (hand-edited) keys: fall back to "just after `before`".
    return generateKeyBetween(before, null);
  }
}

/** A key that sorts after every key in `items`. */
export function positionAfterAll(items: readonly Positioned[]): string {
  const last = [...items].sort(comparePositions).at(-1);
  return positionBetween(last?.position ?? null, null);
}

/** A key that sorts before every key in `items`. */
export function positionBeforeAll(items: readonly Positioned[]): string {
  const first = [...items].sort(comparePositions)[0];
  return positionBetween(null, first?.position ?? null);
}

/**
 * Key for moving something to `index` (0-based) among `siblings`, which must already be sorted and
 * must not contain the item being moved.
 */
export function positionAtIndex(siblings: readonly Positioned[], index: number): string {
  const clamped = Math.max(0, Math.min(index, siblings.length));
  return positionBetween(
    siblings[clamped - 1]?.position ?? null,
    siblings[clamped]?.position ?? null,
  );
}
