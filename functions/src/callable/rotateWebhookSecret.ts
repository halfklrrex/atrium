import { rotateWebhookSecretRequestSchema, rotateWebhookSecretResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminWebhookStore } from '../webhooks/admin-store';
import { webhooksEnabled } from '../webhooks/flag';
import { rotateWebhookSecret as run } from '../webhooks/manage';

/** Replaces a webhook's signing secret and returns the new one once (board owners only) (P8). */
export const rotateWebhookSecret = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(rotateWebhookSecretRequestSchema, request.data, 'rotateWebhookSecret');
  const result = await run(
    { store: adminWebhookStore(db()), now: Date.now, enabled: webhooksEnabled },
    actor.uid,
    input,
  );
  return rotateWebhookSecretResultSchema.parse(result);
});
