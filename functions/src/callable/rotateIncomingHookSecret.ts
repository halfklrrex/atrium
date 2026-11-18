import {
  rotateIncomingHookSecretRequestSchema,
  rotateIncomingHookSecretResultSchema,
} from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminIncomingHookStore } from '../webhooks/incoming-admin-store';
import { webhooksEnabled } from '../webhooks/flag';
import { rotateIncomingHookSecret as run } from '../webhooks/incoming';

/** Replaces an incoming webhook's secret; the old URL stops working (board owners only) (P8). */
export const rotateIncomingHookSecret = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(
    rotateIncomingHookSecretRequestSchema,
    request.data,
    'rotateIncomingHookSecret',
  );
  const result = await run(
    { store: adminIncomingHookStore(db()), now: Date.now, enabled: webhooksEnabled },
    actor.uid,
    input,
  );
  return rotateIncomingHookSecretResultSchema.parse(result);
});
