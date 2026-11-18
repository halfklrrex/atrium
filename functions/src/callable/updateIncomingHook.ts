import { updateIncomingHookRequestSchema, updateIncomingHookResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminIncomingHookStore } from '../webhooks/incoming-admin-store';
import { webhooksEnabled } from '../webhooks/flag';
import { updateIncomingHook as run } from '../webhooks/incoming';

/** Changes an incoming webhook's name, on/off state or default group (board owners only) (P8). */
export const updateIncomingHook = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(updateIncomingHookRequestSchema, request.data, 'updateIncomingHook');
  const result = await run(
    { store: adminIncomingHookStore(db()), now: Date.now, enabled: webhooksEnabled },
    actor.uid,
    input,
  );
  return updateIncomingHookResultSchema.parse(result);
});
