import { FIRESTORE_DATABASE_ID, type BoardColumnsData } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { syncColumnIdLists, type ColumnIdListsStore } from '../lib/derived-column-ids';

/** Admin Firestore adapter: one transaction per update, so a stale event can't overwrite newer data. */
export function adminColumnIdListsStore(): ColumnIdListsStore {
  const firestore = db();
  return {
    update: (boardId, decide) =>
      firestore.runTransaction(async (tx) => {
        const ref = firestore.collection('boards').doc(boardId);
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const next = decide(snap.data() as BoardColumnsData);
        if (next === null) return null;
        tx.update(ref, {
          derivedColumnIds: next.derivedColumnIds,
          serverManagedColumnIds: next.serverManagedColumnIds,
        });
        return next;
      }),
  };
}

/**
 * Keeps `boards/{id}.derivedColumnIds` and `boards/{id}.serverManagedColumnIds` equal to the board's
 * derived and server-managed columns. It is the only writer of those fields (Firestore rules refuse
 * clients) and it writes, in one transaction, only when either value changes, so its own write
 * re-triggers it once and then stops. Idempotent: it also backfills older boards.
 */
export const onBoardColumnsWritten = onDocumentWritten(
  // `database` is required: a trigger without it listens to the project's default database only.
  { document: 'boards/{boardId}', database: FIRESTORE_DATABASE_ID, region: 'europe-west1' },
  async (event) => {
    const after = event.data?.after;
    const result = await syncColumnIdLists(
      adminColumnIdListsStore(),
      event.params.boardId,
      after?.exists ? (after.data() as BoardColumnsData) : undefined,
    );
    if (result.written) {
      logger.info(`Updated derived/server-managed column ids of board ${event.params.boardId}`, {
        ...result.written,
      });
    }
  },
);
