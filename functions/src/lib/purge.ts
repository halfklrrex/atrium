/**
 * Minimal abstraction for deletions so the scheduled purge logic can be unit-tested
 * with in-memory fakes.
 */
export interface PurgeTrashStore {
  findDeletedBoards(cutoff: Date): Promise<readonly { id: string }[]>;
  findDeletedItems(cutoff: Date): Promise<readonly { id: string; boardId: string }[]>;
  purgeBoard(id: string): Promise<void>;
  deleteItems(items: readonly { id: string; boardId: string }[]): Promise<number>;
}

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function getThirtyDayCutoff(now = Date.now()): Date {
  return new Date(now - THIRTY_DAYS_MS);
}

/**
 * Purge boards and items whose `state == 'deleted'` and `deletedAt <= cutoff`.
 * Boards are purged recursively (including subcollections).
 * Returns the counts of records purged.
 */
export async function purgeTrashLogic(
  store: PurgeTrashStore,
  cutoff: Date,
): Promise<{ boardsPurged: number; itemsPurged: number }> {
  const [deletedBoards, deletedItems] = await Promise.all([
    store.findDeletedBoards(cutoff),
    store.findDeletedItems(cutoff),
  ]);

  for (const board of deletedBoards) {
    await store.purgeBoard(board.id);
  }

  if (deletedItems.length > 0) {
    await store.deleteItems(deletedItems);
  }

  return {
    boardsPurged: deletedBoards.length,
    itemsPurged: deletedItems.length,
  };
}

/** Storage for the column-type-change snapshots purge (`boards/{id}/columnSnapshots/{snapshotId}`). */
export interface ColumnSnapshotPurgeStore {
  /** Snapshots whose `expiresAt` (epoch milliseconds) is at or before `nowMs`. */
  findExpiredSnapshots(nowMs: number): Promise<readonly { boardId: string; snapshotId: string }[]>;
  /** Deletes the snapshot document and its chunks. */
  deleteSnapshot(boardId: string, snapshotId: string): Promise<void>;
}

/** Deletes expired column snapshots (30 days after the type change). Returns how many it removed. */
export async function purgeExpiredColumnSnapshots(
  store: ColumnSnapshotPurgeStore,
  nowMs = Date.now(),
): Promise<number> {
  const expired = await store.findExpiredSnapshots(nowMs);
  for (const snapshot of expired) {
    await store.deleteSnapshot(snapshot.boardId, snapshot.snapshotId);
  }
  return expired.length;
}
