import { okResultSchema, revokeInviteRequestSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { revokeInviteInTransaction } from '../lib/membership';
import { adminMembershipTx } from '../lib/membership-admin';

/** Owner or admin withdraws a pending invite. */
export const revokeInvite = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(revokeInviteRequestSchema, request.data, 'revokeInvite');
  const firestore = db();
  await firestore.runTransaction((tx) =>
    revokeInviteInTransaction(adminMembershipTx(firestore, tx), actor, input),
  );
  return okResultSchema.parse({ ok: true });
});
