import { revokeApiTokenRequestSchema, revokeApiTokenResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { adminApiTokenStore } from '../api/admin-token-store';
import { revokeApiToken as run } from '../api/tokens';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';

/** Settings -> API tokens -> Revoke: ends one of the caller's own personal access tokens (P8). */
export const revokeApiToken = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(revokeApiTokenRequestSchema, request.data, 'revokeApiToken');
  const result = await run(adminApiTokenStore(db()), Date.now(), actor.uid, input);
  return revokeApiTokenResultSchema.parse(result);
});
