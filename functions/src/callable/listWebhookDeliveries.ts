import {
  listWebhookDeliveriesRequestSchema,
  listWebhookDeliveriesResultSchema,
} from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminWebhookStore } from '../webhooks/admin-store';
import { webhooksEnabled } from '../webhooks/flag';
import { listWebhookDeliveries as run } from '../webhooks/manage';

/** The most recent deliveries of an outgoing webhook, without payloads (board owners only) (P8). */
export const listWebhookDeliveries = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(
    listWebhookDeliveriesRequestSchema,
    request.data,
    'listWebhookDeliveries',
  );
  const result = await run(
    { store: adminWebhookStore(db()), now: Date.now, enabled: webhooksEnabled },
    actor.uid,
    input,
  );
  return listWebhookDeliveriesResultSchema.parse(result);
});
