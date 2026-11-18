import { deleteWebhookRequestSchema, deleteWebhookResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminWebhookStore } from '../webhooks/admin-store';
import { webhooksEnabled } from '../webhooks/flag';
import { deleteWebhook as run } from '../webhooks/manage';

/** Deletes a webhook and its signing secret (board owners only) (P8). */
export const deleteWebhook = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(deleteWebhookRequestSchema, request.data, 'deleteWebhook');
  const result = await run(
    { store: adminWebhookStore(db()), now: Date.now, enabled: webhooksEnabled },
    actor.uid,
    input,
  );
  return deleteWebhookResultSchema.parse(result);
});
