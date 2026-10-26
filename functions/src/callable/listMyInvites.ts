import { listMyInvitesRequestSchema, listMyInvitesResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { listMyInvites as listMyInvitesFor } from '../lib/membership';
import { adminInviteReader } from '../lib/membership-admin';

/** Pending, unexpired invites addressed to the caller's verified email. */
export const listMyInvites = onCall(async (request) => {
  const actor = actorFromRequest(request);
  parseInput(listMyInvitesRequestSchema, request.data, 'listMyInvites');
  const result = await listMyInvitesFor(adminInviteReader(db()), actor, Date.now());
  return listMyInvitesResultSchema.parse(result);
});
