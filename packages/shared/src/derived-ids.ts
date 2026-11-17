import type { ColumnDef } from './schemas/board';
import { columnRegistry } from './columns';

/**
 * `boards/{id}.derivedColumnIds` (FW1), `boards/{id}.serverManagedColumnIds` (FW2) and
 * `boards/{id}.requiredColumnIds` (REQ-1): which columns of a board are derived (computed, never
 * stored), server-managed (written only by Cloud Functions) or required (never emptied). Firestore
 * rules refuse client writes to the first two lists' `values.<id>` and refuse emptying the third's,
 * and the `onBoardColumnsWritten` Cloud Function is the only writer of all three fields. The pure computation
 * lives here so the Function and the backfill migration share it (and a test can pin it down).
 */

/** The fields of a board document this logic reads. Anything else is ignored. */
export interface BoardColumnsData {
  columns?: unknown;
  subitemColumns?: unknown;
  derivedColumnIds?: unknown;
  serverManagedColumnIds?: unknown;
  requiredColumnIds?: unknown;
  voteColumnIds?: unknown;
}

/**
 * How many required columns the Firestore rules check by value (REQ-1). Rules cannot loop, so
 * `firestore.rules` unrolls the check over the first 10 entries of `requiredColumnIds`. A client
 * write that touches the 21st or a later required column is refused (fail closed, never loosened).
 * Keep this equal to the unrolled helper in `firestore.rules` (a rules test pins it).
 */
export const REQUIRED_COLUMN_RULE_CAP = 10;

/**
 * How many vote columns (columns and subitem columns together) the Firestore rules check by value
 * (vote integrity). Like {@link REQUIRED_COLUMN_RULE_CAP}, `firestore.rules` unrolls the check over
 * the first 10 entries of `voteColumnIds` and refuses writes to a later one (fail closed), so the
 * web refuses to add an 11th vote column. Keep equal to the unrolled helper in `firestore.rules`.
 */
export const VOTE_COLUMN_RULE_CAP = 10;

/** The user-facing refusal when a board would get more vote columns than the rules can protect. */
export const VOTE_COLUMN_CAP_MESSAGE = `A board can have at most ${VOTE_COLUMN_RULE_CAP} vote columns.`;

/**
 * True when turning one more column into a vote column (a new column or a type change to `vote`)
 * would push the board past {@link VOTE_COLUMN_RULE_CAP}. Columns and sub-item columns count
 * together. Other types are never limited.
 */
export function voteCapExceeded(
  toType: string,
  board: { columns?: readonly ColumnDef[] | null; subitemColumns?: readonly ColumnDef[] | null },
): boolean {
  if (toType !== 'vote') return false;
  const all = [...(board.columns ?? []), ...(board.subitemColumns ?? [])];
  return all.filter((c) => c.type === 'vote').length >= VOTE_COLUMN_RULE_CAP;
}

/** The four server-maintained lists of a board. */
export interface ColumnIdLists {
  derivedColumnIds: string[];
  serverManagedColumnIds: string[];
  requiredColumnIds: string[];
  /** Vote columns (SEC vote integrity): rules let a write change only the writer's own uid in them. */
  voteColumnIds: string[];
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

/** Ids of every column and sub-item column marked `required: true` (REQ-1), sorted. */
export function computeRequiredColumnIds(data: BoardColumnsData): string[] {
  return uniqueSorted(columnRegistry.requiredColumnIds(allColumnDefs(data)));
}

/** Ids of every vote column and sub-item vote column (vote integrity in the rules), sorted. */
export function computeVoteColumnIds(data: BoardColumnsData): string[] {
  return uniqueSorted(columnRegistry.voteColumnIds(allColumnDefs(data)));
}

/** All four lists a board should carry. */
export function computeColumnIdLists(data: BoardColumnsData): ColumnIdLists {
  return {
    derivedColumnIds: computeDerivedColumnIds(data),
    serverManagedColumnIds: computeServerManagedColumnIds(data),
    requiredColumnIds: computeRequiredColumnIds(data),
    voteColumnIds: computeVoteColumnIds(data),
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

/** Like {@link nextDerivedColumnIds}, for `requiredColumnIds` (REQ-1). */
export function nextRequiredColumnIds(data: BoardColumnsData): string[] | null {
  const wanted = computeRequiredColumnIds(data);
  return isRight(data.requiredColumnIds, wanted) ? null : wanted;
}

/** Like {@link nextDerivedColumnIds}, for `voteColumnIds`. */
export function nextVoteColumnIds(data: BoardColumnsData): string[] | null {
  const wanted = computeVoteColumnIds(data);
  return isRight(data.voteColumnIds, wanted) ? null : wanted;
}

/**
 * What the `onBoardColumnsWritten` Function should write: all four lists, or `null` when each is
 * already right (no write, so its own write stops re-triggering it). All are written together
 * whenever any one is wrong, in one update.
 */
export function nextColumnIdLists(data: BoardColumnsData): ColumnIdLists | null {
  const wanted = computeColumnIdLists(data);
  return isRight(data.derivedColumnIds, wanted.derivedColumnIds) &&
    isRight(data.serverManagedColumnIds, wanted.serverManagedColumnIds) &&
    isRight(data.requiredColumnIds, wanted.requiredColumnIds) &&
    isRight(data.voteColumnIds, wanted.voteColumnIds)
    ? null
    : wanted;
}
