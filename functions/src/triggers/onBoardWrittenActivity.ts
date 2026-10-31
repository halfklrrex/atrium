import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { recordBoardActivity } from '../lib/activity';
import { adminActivityStore } from '../lib/admin-activity';
import { db } from '../lib/admin';

/**
 * Activity log entries for board writes (P4): renamed, and columns and groups added, renamed or
 * deleted. The actor is the board's `updatedBy` (rules force it to the caller on every client
 * update), falling back to `createdBy`. Column type changes, kind and access changes are logged by
 * their callables instead, and `onBoardColumnsWritten`'s own write changes nothing tracked here.
 * This trigger never writes the board, so it cannot loop.
 */
export const onBoardWrittenActivity = onDocumentWritten(
  {
    document: 'boards/{boardId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'europe-west1',
    retry: true,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!before?.exists || !after?.exists) return;
    const created = await recordBoardActivity(adminActivityStore(db()), {
      eventId: event.id,
      boardId: event.params.boardId,
      before: before.data() ?? {},
      after: after.data() ?? {},
    });
    if (created > 0) {
      logger.info(`Activity for board ${event.params.boardId}`, { created });
    }
  },
);
