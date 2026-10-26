import { acceptInviteRequestSchema, acceptInviteResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { acceptInviteInTransaction } from '../lib/membership';
import { adminMembershipTx } from '../lib/membership-admin';

/** The invitee (matched by verified email) joins the workspace. */
export const acceptInvite = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(acceptInviteRequestSchema, request.data, 'acceptInvite');
  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    acceptInviteInTransaction(adminMembershipTx(firestore, tx), actor, input, Date.now()),
  );
  return acceptInviteResultSchema.parse(result);
});
