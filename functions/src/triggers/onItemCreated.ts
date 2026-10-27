import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { adminItemSeqTx } from '../lib/admin-item-seq';
import { allocateItemNumbers } from '../lib/item-seq';

/**
 * Gives every new item its server-assigned numbers: `seq` (account-wide, Item ID column) and
 * `boardSeq` (per board, Auto number column; subitems have their own sequence). One transaction
 * reads the item and both counters and writes the item fields and the counters, so it is idempotent
 * under retries. It doesn't touch `updatedAt`/`updatedBy`: this is metadata, not an edit.
 *
 * Known limit: the single global counter document handles roughly one write per second sustained.
 * That is fine at family scale; a bulk create (duplicating a group, a future import) just queues
 * transaction retries.
 */
export const onItemCreated = onDocumentCreated(
  {
    // `database` is required: a trigger without it listens to the project's default database only.
    document: 'boards/{boardId}/items/{itemId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'europe-west1',
    retry: true,
  },
  async (event) => {
    const { boardId, itemId } = event.params;
    const firestore = db();
    const numbers = await firestore.runTransaction((tx) =>
      allocateItemNumbers(adminItemSeqTx(firestore, tx), boardId, itemId),
    );
    if (numbers) logger.info(`Numbered item ${boardId}/${itemId}`, numbers);
  },
);
