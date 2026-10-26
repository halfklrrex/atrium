import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../lib/admin';
import { getThirtyDayCutoff, purgeTrashLogic, type PurgeTrashStore } from '../lib/purge';

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
    logger.info(
      `Purge completed: ${result.boardsPurged} boards and ${result.itemsPurged} items purged.`,
      result,
    );
  },
);
