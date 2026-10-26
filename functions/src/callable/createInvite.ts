import { APP_BASE_URL, createInviteRequestSchema, createInviteResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { createInviteInTransaction } from '../lib/membership';
import { adminMembershipTx } from '../lib/membership-admin';

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
  return createInviteResultSchema.parse(result);
});
