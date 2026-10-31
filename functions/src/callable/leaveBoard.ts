import { boardSharingResultSchema, leaveBoardRequestSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { adminBoardSharingTx, db } from '../lib/admin';
import { leaveBoardInTransaction } from '../lib/board-sharing';

/** An explicit member leaves a private or shareable board (unless the last owner). */
export const leaveBoard = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(leaveBoardRequestSchema, request.data, 'leaveBoard');
  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    leaveBoardInTransaction(adminBoardSharingTx(firestore, tx), actor.uid, input),
  );
  return boardSharingResultSchema.parse(result);
});
