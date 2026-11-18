import { createIncomingHookRequestSchema, createIncomingHookResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { adminIncomingHookStore } from '../webhooks/incoming-admin-store';
import { webhooksEnabled } from '../webhooks/flag';
import { createIncomingHook as run } from '../webhooks/incoming';

/** Creates an incoming webhook on a board (board owners only) and returns its secret URL once (P8). */
export const createIncomingHook = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(createIncomingHookRequestSchema, request.data, 'createIncomingHook');
  const result = await run(
    { store: adminIncomingHookStore(db()), now: Date.now, enabled: webhooksEnabled },
    actor.uid,
    input,
  );
  return createIncomingHookResultSchema.parse(result);
});
