import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { adminNotificationStore } from '../lib/admin-notifications';
import { notifyPeopleAssigned } from '../lib/notifications';

/**
 * Bell notification `assigned`: someone was added to a People column on an item (also on create,
 * with a pre-filled value). Returns without reading anything unless `values` changed.
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
    const created = await notifyPeopleAssigned(adminNotificationStore(db()), {
      eventId: event.id,
      boardId: event.params.boardId,
      itemId: event.params.itemId,
      ...(before?.exists ? { before: before.data() ?? {} } : {}),
      after: after.data() ?? {},
    });
    if (created > 0) logger.info(`Assigned notifications for ${event.params.itemId}`, { created });
  },
);
