import { okResultSchema, removeMemberRequestSchema } from '@atrium/shared';
import { logger } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { cleanupBoardAccess, removeMemberInTransaction } from '../lib/membership';
import { adminBoardAccessStore, adminMembershipTx } from '../lib/membership-admin';

/** Owner (anyone but themself) or admin (non-admins) removes a member, then strips board access. */
export const removeMember = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(removeMemberRequestSchema, request.data, 'removeMember');
  const firestore = db();
  await firestore.runTransaction((tx) =>
    removeMemberInTransaction(adminMembershipTx(firestore, tx), actor, input),
  );
  await cleanupBoardAccess(
    adminBoardAccessStore(firestore),
    input.workspaceId,
    input.uid,
    (message, error) => logger.error(message, error),
  );
  return okResultSchema.parse({ ok: true });
});
