import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { adminRequiredRevertStore } from '../lib/admin-required-revert';
import { revertDoneWithEmptyRequired } from '../lib/required-revert';

/**
 * Required columns, rule 2 (REQ-2): puts a Status back when a write moved it into a done label
 * while another required cell on the item was empty, and logs why (`required_reverted`). Eventual,
 * not atomic: the item shows Done for a moment. Skips boards without `requiredColumnIds`. The
 * revert moves a Status out of done, so its own event is a no-op (no loop).
 */
export const onItemRequiredRevert = onDocumentUpdated(
  {
    // `database` is required: a trigger without it listens to the project's default database only.
    document: 'boards/{boardId}/items/{itemId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'europe-west1',
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!before?.exists || !after?.exists) return;
    const outcome = await revertDoneWithEmptyRequired(adminRequiredRevertStore(db()), {
      eventId: event.id,
      boardId: event.params.boardId,
      itemId: event.params.itemId,
      before: before.data() ?? {},
      after: after.data() ?? {},
    });
    if (outcome.reverted) {
      logger.info(`Reverted Done on item ${event.params.itemId}: required cells empty`, {
        columnIds: outcome.columnIds,
      });
    }
  },
);
