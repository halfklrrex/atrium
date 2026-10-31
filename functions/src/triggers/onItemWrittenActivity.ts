import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { recordItemActivity } from '../lib/activity';
import { adminActivityStore } from '../lib/admin-activity';
import { db } from '../lib/admin';

/**
 * Activity log entries for item writes (P4): created, renamed, moved, archived, deleted, restored
 * and one `value_changed` per changed cell. The actor is the item's `updatedBy`. Deletes of the doc
 * (a hard purge) and writes that change nothing the log tracks (`seq`, `boardSeq`,
 * `descriptionImages`, `updatesCount`, the index fields) write nothing. This trigger never writes
 * the item, so it cannot loop.
 */
export const onItemWrittenActivity = onDocumentWritten(
  {
    // `database` is required: a trigger without it listens to the project's default database only.
    document: 'boards/{boardId}/items/{itemId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'europe-west1',
    retry: true,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const before = event.data?.before;
    const created = await recordItemActivity(adminActivityStore(db()), {
      eventId: event.id,
      boardId: event.params.boardId,
      itemId: event.params.itemId,
      ...(before?.exists ? { before: before.data() ?? {} } : {}),
      after: after.data() ?? {},
    });
    if (created > 0) {
      logger.info(`Activity for item ${event.params.itemId}`, { created });
    }
  },
);
