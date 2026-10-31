import { boardSharingResultSchema, setBoardAccessRequestSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { adminBoardSharingTx, db } from '../lib/admin';
import { setBoardAccessInTransaction } from '../lib/board-sharing';

/** Adds, changes or removes one person's explicit access to a board (board owners only). */
export const setBoardAccess = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(setBoardAccessRequestSchema, request.data, 'setBoardAccess');
  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    setBoardAccessInTransaction(adminBoardSharingTx(firestore, tx), actor.uid, input),
  );
  return boardSharingResultSchema.parse(result);
});
