import { acceptInviteRequestSchema, acceptInviteResultSchema } from '@atrium/shared';
import { logger } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { acceptInviteInTransaction } from '../lib/membership';
import { adminMembershipTx } from '../lib/membership-admin';
import { adminProfileStore } from '../lib/admin-profile';
import { syncProfileToWorkspaces } from '../lib/profile';

/** The invitee (matched by verified email) joins the workspace. */
export const acceptInvite = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(acceptInviteRequestSchema, request.data, 'acceptInvite');
  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    acceptInviteInTransaction(adminMembershipTx(firestore, tx), actor, input, Date.now()),
  );
  const parsed = acceptInviteResultSchema.parse(result);
  // The new member doc starts without the optional profile fields: copy them (best effort).
  try {
    await syncProfileToWorkspaces(adminProfileStore(firestore), actor.uid, [parsed.workspaceId]);
  } catch (error) {
    logger.warn('Profile copy after acceptInvite failed', error);
  }
  return parsed;
});
