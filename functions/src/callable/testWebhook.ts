import { testWebhookRequestSchema, testWebhookResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminWebhookStore } from '../webhooks/admin-store';
import { webhooksEnabled } from '../webhooks/flag';
import { testWebhook as run } from '../webhooks/manage';

/** Queues a `ping` delivery to a webhook (board owners only); the next sweep sends it (P8). */
export const testWebhook = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(testWebhookRequestSchema, request.data, 'testWebhook');
  const result = await run(
    { store: adminWebhookStore(db()), now: Date.now, enabled: webhooksEnabled },
    actor.uid,
    actor.displayName ?? 'A board owner',
    input,
  );
  return testWebhookResultSchema.parse(result);
});
