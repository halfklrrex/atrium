import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { adminDocNotificationStore } from '../lib/admin-notifications';
import { notifyDocMentions } from '../lib/notifications';

/** Bell notification `mention` for people newly @mentioned in a doc body (P7 PR 6). */
export const onDocBodyWritten = onDocumentWritten(
  {
    document: 'docs/{docId}/content/body',
    database: FIRESTORE_DATABASE_ID,
    region: 'europe-west1',
    retry: true,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const before = event.data?.before;
    const created = await notifyDocMentions(adminDocNotificationStore(db()), {
      eventId: event.id,
      docId: event.params.docId,
      ...(before?.exists ? { before: before.data() ?? {} } : {}),
      after: after.data() ?? {},
    });
    if (created > 0) {
      logger.info(`Doc mention notifications for ${event.params.docId}`, { created });
    }
  },
);
