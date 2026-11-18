import { WEBHOOK_DELIVERY_RETENTION_DAYS, WEBHOOK_EVENT_ALL } from '@atrium/shared';
import { buildEventPayload, type ActivityInput } from './payload';
import type { WebhookStore } from './store';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EnqueueDeps {
  store: WebhookStore;
  now: () => number;
  /** The `WEBHOOKS_ENABLED` flag; when off nothing is read or written. */
  enabled: () => boolean;
}

/** `${webhookId}_${activityId}`: one delivery per webhook per event, so a retried trigger adds none. */
export const deliveryId = (webhookId: string, activityId: string): string =>
  `${webhookId}_${activityId}`;

/**
 * The producer (P8 PR 6): for one new activity entry, queues one delivery per enabled webhook of the
 * board that subscribed to its kind. Loads the board's webhooks once and builds the body once.
 * Create-if-absent writes make it idempotent. Returns how many deliveries were newly queued.
 */
export async function enqueueWebhooks(
  deps: EnqueueDeps,
  args: { boardId: string; activityId: string; activity: ActivityInput },
): Promise<number> {
  if (!deps.enabled()) return 0;
  const webhooks = await deps.store.listEnabledWebhooks(args.boardId);
  const matching = webhooks.filter(
    ({ doc }) => doc.events.includes(WEBHOOK_EVENT_ALL) || doc.events.includes(args.activity.kind),
  );
  if (matching.length === 0) return 0;
  const now = deps.now();
  const { body } = buildEventPayload({
    eventId: args.activityId,
    boardId: args.boardId,
    activity: args.activity,
    nowMs: now,
  });
  let created = 0;
  for (const { id: webhookId } of matching) {
    const wasCreated = await deps.store.createDelivery(deliveryId(webhookId, args.activityId), {
      boardId: args.boardId,
      webhookId,
      eventId: args.activityId,
      eventType: args.activity.kind,
      payload: body,
      attempt: 0,
      nextAttemptAt: now,
      status: 'pending',
      lastStatus: null,
      lastError: null,
      createdAt: now,
      expiresAt: now + WEBHOOK_DELIVERY_RETENTION_DAYS * DAY_MS,
    });
    if (wasCreated) created += 1;
  }
  return created;
}
