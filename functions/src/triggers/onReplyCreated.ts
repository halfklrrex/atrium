import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { adminNotificationStore } from '../lib/admin-notifications';
import { notifyReply } from '../lib/notifications';

/** Bell notifications for a reply: `reply` to the update's author, `mention` to the mentioned ids. */
export const onReplyCreated = onDocumentCreated(
  {
    document: 'boards/{boardId}/items/{itemId}/updates/{updateId}/replies/{replyId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'europe-west1',
    retry: true,
  },
  async (event) => {
    const reply = event.data?.data();
    if (!reply) return;
    const created = await notifyReply(adminNotificationStore(db()), {
      eventId: event.id,
      boardId: event.params.boardId,
      itemId: event.params.itemId,
      updateId: event.params.updateId,
      replyId: event.params.replyId,
      reply,
    });
    if (created > 0) logger.info(`Notifications for reply ${event.params.replyId}`, { created });
  },
);
