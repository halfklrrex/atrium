import { createApiTokenRequestSchema, createApiTokenResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { adminApiTokenStore } from '../api/admin-token-store';
import { createApiToken as run } from '../api/tokens';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';

/** Settings -> API tokens -> Create: returns the new personal access token once (P8). */
export const createApiToken = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(createApiTokenRequestSchema, request.data, 'createApiToken');
  const result = await run(adminApiTokenStore(db()), Date.now(), actor.uid, input);
  return createApiTokenResultSchema.parse(result);
});
