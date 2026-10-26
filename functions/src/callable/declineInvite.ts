import { declineInviteRequestSchema, okResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { declineInviteInTransaction } from '../lib/membership';
import { adminMembershipTx } from '../lib/membership-admin';

/** The invitee turns an invite down. */
export const declineInvite = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(declineInviteRequestSchema, request.data, 'declineInvite');
  const firestore = db();
  await firestore.runTransaction((tx) =>
    declineInviteInTransaction(adminMembershipTx(firestore, tx), actor, input),
  );
  return okResultSchema.parse({ ok: true });
});
