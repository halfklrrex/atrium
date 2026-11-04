import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { adminAutomationStore } from '../lib/admin-automations';
import { adminNotificationStore } from '../lib/admin-notifications';
import { handleActivityEvent } from '../lib/automations/run';

/**
 * The automation engine (P5a): every new activity entry is offered to the board's enabled recipes.
 * A recipe runs in one transaction as its creator and writes the item with the loop marker
 * (`updatedVia`, `automationDepth`, `automationRunId`); the activity trigger then logs that write
 * under the automation's name with the chain's depth. Idempotent under retries (run document id
 * `${automationId}-${eventId}`). Loads the board's automations once per event.
 */
export const onActivityCreated = onDocumentCreated(
  {
    // `database` is required: a trigger without it listens to the project's default database only.
    document: 'boards/{boardId}/activity/{activityId}',
    database: FIRESTORE_DATABASE_ID,
    region: 'europe-west1',
    retry: true,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    const firestore = db();
    const outcomes = await handleActivityEvent(
      {
        store: adminAutomationStore(firestore),
        notifications: adminNotificationStore(firestore),
        serverTimestamp: FieldValue.serverTimestamp(),
        log: (message, meta) => logger.error(message, meta),
      },
      {
        eventId: event.params.activityId,
        boardId: event.params.boardId,
        activity: {
          kind: String(data.kind ?? ''),
          actorId: String(data.actorId ?? ''),
          itemId: typeof data.itemId === 'string' ? data.itemId : null,
          itemName: typeof data.itemName === 'string' ? data.itemName : null,
          parentItemId: typeof data.parentItemId === 'string' ? data.parentItemId : null,
          columnId: typeof data.columnId === 'string' ? data.columnId : null,
          groupId: typeof data.groupId === 'string' ? data.groupId : null,
          data: (data.data ?? {}) as { toValue?: unknown; depth?: number },
        },
      },
    );
    if (outcomes.length > 0) {
      logger.info(`Automations for activity ${event.params.activityId}`, {
        boardId: event.params.boardId,
        statuses: outcomes.map((o) => o.status),
      });
    }
  },
);
