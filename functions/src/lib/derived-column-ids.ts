import { nextColumnIdLists, type BoardColumnsData, type ColumnIdLists } from '@atrium/shared';

/**
 * Keeps `boards/{id}.derivedColumnIds` (FW1) and `boards/{id}.serverManagedColumnIds` (FW2) in step
 * with the board's columns. Clients can't write those fields (Firestore rules), so this is the only
 * writer; the Admin SDK bypasses rules. The computation itself is `nextColumnIdLists` in
 * `@atrium/shared`, shared with the backfill migration. What lives here is the trigger body, which
 * takes an injected store so it can be unit-tested.
 */

/** Storage the trigger writes through: one read-modify-write of one board. */
export interface ColumnIdListsStore {
  /**
   * Runs `decide` on the board's *current* data (not the possibly older event snapshot) and writes
   * the lists it returns; `null` means no write. Does nothing when the board no longer exists.
   * Resolves to the lists that were written, or `null`.
   */
  update(
    boardId: string,
    decide: (data: BoardColumnsData) => ColumnIdLists | null,
  ): Promise<ColumnIdLists | null>;
}

/**
 * Trigger body. `after` is the board data from the event (`undefined` when the board was deleted).
 * Skips without any read when the event data is already consistent; otherwise recomputes both lists
 * against the current document inside the store's transaction and writes only if either differs.
 */
export async function syncColumnIdLists(
  store: ColumnIdListsStore,
  boardId: string,
  after: BoardColumnsData | undefined,
): Promise<{ written: ColumnIdLists | null }> {
  if (!after) return { written: null };
  if (nextColumnIdLists(after) === null) return { written: null };
  return { written: await store.update(boardId, nextColumnIdLists) };
}
