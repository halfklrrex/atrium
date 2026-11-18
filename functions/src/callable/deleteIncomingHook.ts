import { deleteIncomingHookRequestSchema, deleteIncomingHookResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminIncomingHookStore } from '../webhooks/incoming-admin-store';
import { webhooksEnabled } from '../webhooks/flag';
import { deleteIncomingHook as run } from '../webhooks/incoming';

/** Deletes an incoming webhook (board owners only) (P8). */
export const deleteIncomingHook = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(deleteIncomingHookRequestSchema, request.data, 'deleteIncomingHook');
  const result = await run(
    { store: adminIncomingHookStore(db()), now: Date.now, enabled: webhooksEnabled },
    actor.uid,
    input,
  );
  return deleteIncomingHookResultSchema.parse(result);
});
