import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { adminFileStorageBucket, db } from '../lib/admin';
import { sweepOrphanUploads, type OrphanSweeperStore } from '../lib/file-storage';

export function adminOrphanSweeperStore(): OrphanSweeperStore {
  const firestore = db();
  const bucket = adminFileStorageBucket();

  return {
    async listUploadFiles() {
      if (bucket.listUploadFiles) {
        return await bucket.listUploadFiles('boards/');
      }
      return [];
    },
    async isStoragePathReferenced(boardId: string, itemId: string, storagePath: string) {
      const itemSnap = await firestore
        .collection('boards')
        .doc(boardId)
        .collection('items')
        .doc(itemId)
        .get();

      if (!itemSnap.exists) {
        return false;
      }

      const values = itemSnap.get('values') as Record<string, unknown> | undefined;
      if (!values) return false;

      for (const val of Object.values(values)) {
        if (val && typeof val === 'object' && Array.isArray((val as { files?: unknown }).files)) {
          const files = (val as { files: Array<{ storagePath?: string }> }).files;
          if (files.some((f) => f && f.storagePath === storagePath)) {
            return true;
          }
        }
      }
      return false;
    },
    async deleteFile(storagePath: string) {
      await bucket.deleteFile(storagePath);
    },
  };
}

export const purgeOrphanUploads = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'Etc/UTC',
  },
  async () => {
    logger.info('Starting daily purge of orphan storage uploads...');
    const oneHourAgoMs = Date.now() - 60 * 60 * 1000;
    const store = adminOrphanSweeperStore();
    const { scanned, deleted } = await sweepOrphanUploads(store, oneHourAgoMs);
    logger.info(
      `Orphan upload purge finished: scanned ${scanned} files, deleted ${deleted} orphan objects.`,
    );
  },
);
