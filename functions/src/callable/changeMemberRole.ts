import { changeMemberRoleRequestSchema, okResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { changeMemberRoleInTransaction } from '../lib/membership';
import { adminMembershipTx } from '../lib/membership-admin';

/** Owner (any role, including ownership transfer) or admin (member and viewer only). */
export const changeMemberRole = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(changeMemberRoleRequestSchema, request.data, 'changeMemberRole');
  const firestore = db();
  await firestore.runTransaction((tx) =>
    changeMemberRoleInTransaction(adminMembershipTx(firestore, tx), actor, input),
  );
  return okResultSchema.parse({ ok: true });
});
