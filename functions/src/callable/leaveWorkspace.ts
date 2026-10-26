import { leaveWorkspaceRequestSchema, okResultSchema } from '@atrium/shared';
import { logger } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { db } from '../lib/admin';
import { cleanupBoardAccess, leaveWorkspaceInTransaction } from '../lib/membership';
import { adminBoardAccessStore, adminMembershipTx } from '../lib/membership-admin';

/** A member (not the owner) leaves a workspace. */
export const leaveWorkspace = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(leaveWorkspaceRequestSchema, request.data, 'leaveWorkspace');
  const firestore = db();
  await firestore.runTransaction((tx) =>
    leaveWorkspaceInTransaction(adminMembershipTx(firestore, tx), actor, input.workspaceId),
  );
  await cleanupBoardAccess(
    adminBoardAccessStore(firestore),
    input.workspaceId,
    actor.uid,
    (message, error) => logger.error(message, error),
  );
  return okResultSchema.parse({ ok: true });
});
