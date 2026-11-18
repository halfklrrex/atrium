import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { adminAutomationStore } from '../lib/admin-automations';
import { adminNotificationStore } from '../lib/admin-notifications';
import { handleActivityEvent } from '../lib/automations/run';
import { adminWebhookStore } from '../webhooks/admin-store';
import { enqueueWebhooks } from '../webhooks/enqueue';
import { webhooksEnabled } from '../webhooks/flag';

/**
 * The automation engine (P5a): every new activity entry is offered to the board's enabled recipes.
 * A recipe runs in one transaction as its creator and writes the item with the loop marker
 * (`updatedVia`, `automationDepth`, `automationRunId`); the activity trigger then logs that write
 * under the automation's name with the chain's depth. Idempotent under retries (run document id
 * `${automationId}-${eventId}`). Loads the board's automations once per event.
 *
 * The same entry is also queued for the board's outgoing webhooks (P8 PR 6, `enqueueWebhooks`), before
 * the automations run and in its own try/catch: a failure there is logged without payloads and never
 * breaks the automation path.
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
    if (webhooksEnabled()) {
      try {
        const createdAt: unknown = data.createdAt;
        await enqueueWebhooks(
          { store: adminWebhookStore(firestore), now: Date.now, enabled: webhooksEnabled },
          {
            boardId: event.params.boardId,
            activityId: event.params.activityId,
            activity: {
              kind: String(data.kind ?? ''),
              actorId: String(data.actorId ?? ''),
              actorName: typeof data.actorName === 'string' ? data.actorName : '',
              itemId: typeof data.itemId === 'string' ? data.itemId : null,
              itemName: typeof data.itemName === 'string' ? data.itemName : null,
              columnId: typeof data.columnId === 'string' ? data.columnId : null,
              data: (data.data ?? {}) as Record<string, unknown>,
              createdAtMs:
                typeof (createdAt as { toMillis?: unknown } | undefined)?.toMillis === 'function'
                  ? (createdAt as { toMillis(): number }).toMillis()
                  : null,
            },
          },
        );
      } catch (error) {
        // Ids and the error code only: never the payload.
        logger.error('Queuing webhooks failed', {
          boardId: event.params.boardId,
          activityId: event.params.activityId,
          code: (error as { code?: unknown } | null)?.code ?? 'unknown',
        });
      }
    }
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
