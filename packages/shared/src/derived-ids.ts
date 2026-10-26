import type { ColumnDef } from './schemas/board';
import { columnRegistry } from './columns';

/**
 * `boards/{id}.derivedColumnIds` (FW1) and `boards/{id}.serverManagedColumnIds` (FW2): which columns
 * of a board are derived (computed, never stored) or server-managed (written only by Cloud
 * Functions). Firestore rules refuse client writes to those `values.<id>`, and the
 * `onBoardColumnsWritten` Cloud Function is the only writer of both fields. The pure computation
 * lives here so the Function and the backfill migration share it (and a test can pin it down).
 */

/** The fields of a board document this logic reads. Anything else is ignored. */
export interface BoardColumnsData {
  columns?: unknown;
  subitemColumns?: unknown;
  derivedColumnIds?: unknown;
  serverManagedColumnIds?: unknown;
}

/** The two server-maintained lists of a board. */
export interface ColumnIdLists {
  derivedColumnIds: string[];
  serverManagedColumnIds: string[];
}

/** Column defs from a stored list; malformed entries (no string `id` and `type`) are skipped. */
function columnDefsOf(list: unknown): ColumnDef[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (c): c is ColumnDef =>
      typeof c === 'object' &&
      c !== null &&
      typeof (c as { id?: unknown }).id === 'string' &&
      typeof (c as { type?: unknown }).type === 'string',
  );
}

/** Every column def of the board: sub-items live in the same `items` collection, so they count too. */
function allColumnDefs(data: BoardColumnsData): ColumnDef[] {
  return [...columnDefsOf(data.columns), ...columnDefsOf(data.subitemColumns)];
}

const uniqueSorted = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/** Ids of every derived column of the board, sorted. */
export function computeDerivedColumnIds(data: BoardColumnsData): string[] {
  return uniqueSorted(columnRegistry.derivedColumnIds(allColumnDefs(data)));
}

/** Ids of every server-managed column of the board (FW2), sorted. */
export function computeServerManagedColumnIds(data: BoardColumnsData): string[] {
  return uniqueSorted(columnRegistry.serverManagedColumnIds(allColumnDefs(data)));
}

/** Both lists a board should carry. */
export function computeColumnIdLists(data: BoardColumnsData): ColumnIdLists {
  return {
    derivedColumnIds: computeDerivedColumnIds(data),
    serverManagedColumnIds: computeServerManagedColumnIds(data),
  };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * True when `current` is a well-formed string list equal to `wanted` (sorted), whatever order it is
 * stored in. A missing or malformed field (e.g. a forged `null`) is never right.
 */
function isRight(current: unknown, wanted: readonly string[]): boolean {
  return (
    Array.isArray(current) &&
    current.every((v) => typeof v === 'string') &&
    sameList([...(current as string[])].sort(), wanted)
  );
}

/**
 * The list to write, or `null` when the board already has the right one (the common case, which is
 * also what stops the write from re-triggering the Function forever). Lists are compared sorted, so
 * the order the ids happen to be stored in never causes a write. A missing or malformed field
 * (e.g. a forged `null`) counts as wrong and is rewritten.
 */
export function nextDerivedColumnIds(data: BoardColumnsData): string[] | null {
  const wanted = computeDerivedColumnIds(data);
  return isRight(data.derivedColumnIds, wanted) ? null : wanted;
}

/** Like {@link nextDerivedColumnIds}, for `serverManagedColumnIds`. */
export function nextServerManagedColumnIds(data: BoardColumnsData): string[] | null {
  const wanted = computeServerManagedColumnIds(data);
  return isRight(data.serverManagedColumnIds, wanted) ? null : wanted;
}

/**
 * What the `onBoardColumnsWritten` Function should write: both lists, or `null` when each is already
 * right (no write, so its own write stops re-triggering it). Both are written together whenever
 * either one is wrong, in one update.
 */
export function nextColumnIdLists(data: BoardColumnsData): ColumnIdLists | null {
  const wanted = computeColumnIdLists(data);
  return isRight(data.derivedColumnIds, wanted.derivedColumnIds) &&
    isRight(data.serverManagedColumnIds, wanted.serverManagedColumnIds)
    ? null
    : wanted;
}
