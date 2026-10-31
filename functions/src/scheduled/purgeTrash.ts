import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import {
  getThirtyDayCutoff,
  purgeExpiredColumnSnapshots,
  purgeTrashLogic,
  type ColumnSnapshotPurgeStore,
  type PurgeTrashStore,
} from '../lib/purge';

/**
 * Creates an admin Firestore adapter for the purge logic.
 */
export function adminPurgeStore(): PurgeTrashStore {
  const firestore = db();

  return {
    async findDeletedBoards(cutoff: Date) {
      const snap = await firestore
        .collection('boards')
        .where('state', '==', 'deleted')
        .where('deletedAt', '<=', cutoff)
        .get();
      return snap.docs.map((d) => ({ id: d.id }));
    },

    async findDeletedItems(cutoff: Date) {
      const snap = await firestore
        .collectionGroup('items')
        .where('state', '==', 'deleted')
        .where('deletedAt', '<=', cutoff)
        .get();
      return snap.docs.map((d) => ({
        id: d.id,
        boardId: d.ref.parent.parent?.id ?? '',
      }));
    },

    async purgeBoard(id: string) {
      const boardRef = firestore.collection('boards').doc(id);
      await firestore.recursiveDelete(boardRef);
    },

    async deleteItems(items) {
      let totalDeleted = 0;
      let batch = firestore.batch();
      let batchCount = 0;

      for (const item of items) {
        if (!item.boardId) continue;
        const itemRef = firestore
          .collection('boards')
          .doc(item.boardId)
          .collection('items')
          .doc(item.id);

        batch.delete(itemRef);
        batchCount++;
        totalDeleted++;

        if (batchCount === 400) {
          await batch.commit();
          batch = firestore.batch();
          batchCount = 0;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
      }

      return totalDeleted;
    },
  };
}

/** Admin Firestore adapter for the expired column snapshots purge. */
export function adminColumnSnapshotPurgeStore(): ColumnSnapshotPurgeStore {
  const firestore = db();
  return {
    async findExpiredSnapshots(nowMs) {
      const snap = await firestore
        .collectionGroup('columnSnapshots')
        .where('expiresAt', '<=', nowMs)
        .get();
      return snap.docs.flatMap((d) => {
        const boardId = d.ref.parent.parent?.id;
        return boardId ? [{ boardId, snapshotId: d.id }] : [];
      });
    },
    async deleteSnapshot(boardId, snapshotId) {
      await firestore.recursiveDelete(
        firestore.collection('boards').doc(boardId).collection('columnSnapshots').doc(snapshotId),
      );
    },
  };
}

/**
 * Scheduled Cloud Function running daily at 02:00 UTC to purge soft-deleted records older than 30 days.
 */
export const purgeTrash = onSchedule(
  {
    schedule: '0 2 * * *',
    timeZone: 'UTC',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const cutoff = getThirtyDayCutoff();
    const result = await purgeTrashLogic(adminPurgeStore(), cutoff);
    const snapshotsPurged = await purgeExpiredColumnSnapshots(adminColumnSnapshotPurgeStore());
    logger.info(`Purged ${snapshotsPurged} expired column snapshots.`, { snapshotsPurged });
    logger.info(
      `Purge completed: ${result.boardsPurged} boards and ${result.itemsPurged} items purged.`,
      result,
    );
  },
);
