import { updateWebhookRequestSchema, updateWebhookResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminWebhookStore } from '../webhooks/admin-store';
import { webhooksEnabled } from '../webhooks/flag';
import { updateWebhook as run } from '../webhooks/manage';

/** Changes a webhook's name, address, events or on/off state (board owners only) (P8). */
export const updateWebhook = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(updateWebhookRequestSchema, request.data, 'updateWebhook');
  const result = await run(
    { store: adminWebhookStore(db()), now: Date.now, enabled: webhooksEnabled },
    actor.uid,
    input,
  );
  return updateWebhookResultSchema.parse(result);
});
