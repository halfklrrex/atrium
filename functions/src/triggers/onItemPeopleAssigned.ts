import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { adminNotificationStore } from '../lib/admin-notifications';
import { notifyDescriptionMentions, notifyPeopleAssigned } from '../lib/notifications';

/**
 * Item-write notifications. The name is older than the job: it covers `assigned` (someone was added
 * to a People column, also on create) and `mention` (a new @ chip in the description). Both helpers
 * return without reading anything unless `values` or `description` changed.
 */
export const onItemPeopleAssigned = onDocumentWritten(
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
    const change = {
      eventId: event.id,
      boardId: event.params.boardId,
      itemId: event.params.itemId,
      ...(before?.exists ? { before: before.data() ?? {} } : {}),
      after: after.data() ?? {},
    };
    const store = adminNotificationStore(db());
    const assigned = await notifyPeopleAssigned(store, change);
    if (assigned > 0) {
      logger.info(`Assigned notifications for ${event.params.itemId}`, { created: assigned });
    }
    const mentioned = await notifyDescriptionMentions(store, change);
    if (mentioned > 0) {
      logger.info(`Description mention notifications for ${event.params.itemId}`, {
        created: mentioned,
      });
    }
  },
);
