import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { recordUpdatePosted } from '../lib/activity';
import { db } from '../lib/admin';
import { adminActivityStore } from '../lib/admin-activity';
import { adminNotificationStore } from '../lib/admin-notifications';
import { notifyUpdateMentions } from '../lib/notifications';

/** Bell notification `mention` for the ids an update mentions, and the activity log's `update_posted`. */
export const onUpdateCreated = onDocumentCreated(
  {
    document: 'boards/{boardId}/items/{itemId}/updates/{updateId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'europe-west1',
    retry: true,
  },
  async (event) => {
    const update = event.data?.data();
    if (!update) return;
    const created = await notifyUpdateMentions(adminNotificationStore(db()), {
      eventId: event.id,
      boardId: event.params.boardId,
      itemId: event.params.itemId,
      updateId: event.params.updateId,
      update,
    });
    if (created > 0) {
      logger.info(`Mention notifications for update ${event.params.updateId}`, { created });
    }
    await recordUpdatePosted(adminActivityStore(db()), {
      eventId: event.id,
      boardId: event.params.boardId,
      itemId: event.params.itemId,
      update,
    });
  },
);
