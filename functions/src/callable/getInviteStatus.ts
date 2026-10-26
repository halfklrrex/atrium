import { getInviteStatusRequestSchema, getInviteStatusResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { getInviteStatus as getInviteStatusFor } from '../lib/membership';
import { adminInviteReader } from '../lib/membership-admin';

/** Lets the invite page explain a link that cannot be used (wrong email, expired, revoked...). */
export const getInviteStatus = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(getInviteStatusRequestSchema, request.data, 'getInviteStatus');
  const result = await getInviteStatusFor(adminInviteReader(db()), actor, input, Date.now());
  return getInviteStatusResultSchema.parse(result);
});
