import { APP_BASE_URL, createInviteRequestSchema, createInviteResultSchema } from '@atrium/shared';
import { logger } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { createInviteInTransaction } from '../lib/membership';
import { adminMembershipTx } from '../lib/membership-admin';
import { adminProfileStore } from '../lib/admin-profile';
import { syncProfileToWorkspaces } from '../lib/profile';

/** Owner or admin invites an email address to a workspace; returns the link to send them. */
export const createInvite = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(createInviteRequestSchema, request.data, 'createInvite');
  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    createInviteInTransaction(
      adminMembershipTx(firestore, tx),
      actor,
      input,
      Date.now(),
      APP_BASE_URL,
    ),
  );
  const parsed = createInviteResultSchema.parse(result);
  // The inviter's member doc may just have been healed without the optional profile fields.
  try {
    await syncProfileToWorkspaces(adminProfileStore(firestore), actor.uid, [input.workspaceId]);
  } catch (error) {
    logger.warn('Profile copy after createInvite failed', error);
  }
  return parsed;
});
