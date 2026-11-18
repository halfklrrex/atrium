import { createWebhookRequestSchema, createWebhookResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminWebhookStore } from '../webhooks/admin-store';
import { webhooksEnabled } from '../webhooks/flag';
import { createWebhook as run } from '../webhooks/manage';

/** Creates an outgoing webhook on a board (board owners only) and returns its signing secret once (P8). */
export const createWebhook = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(createWebhookRequestSchema, request.data, 'createWebhook');
  const result = await run(
    { store: adminWebhookStore(db()), now: Date.now, enabled: webhooksEnabled },
    actor.uid,
    input,
  );
  return createWebhookResultSchema.parse(result);
});
