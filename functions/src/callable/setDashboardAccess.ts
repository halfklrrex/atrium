import { boardSharingResultSchema, setDashboardAccessRequestSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { adminDashboardSharingTx, db } from '../lib/admin';
import { setDashboardAccessInTransaction } from '../lib/dashboard-sharing';

/** Changes a dashboard's kind and/or one person's access to it (dashboard owners only). */
export const setDashboardAccess = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(setDashboardAccessRequestSchema, request.data, 'setDashboardAccess');
  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    setDashboardAccessInTransaction(adminDashboardSharingTx(firestore, tx), actor.uid, input),
  );
  return boardSharingResultSchema.parse(result);
});
