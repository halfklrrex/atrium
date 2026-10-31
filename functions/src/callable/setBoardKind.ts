import { boardSharingResultSchema, setBoardKindRequestSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { adminBoardSharingTx, db } from '../lib/admin';
import { setBoardKindInTransaction } from '../lib/board-sharing';

/** Changes a board between main, private and shareable (board owners only). */
export const setBoardKind = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(setBoardKindRequestSchema, request.data, 'setBoardKind');
  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    setBoardKindInTransaction(adminBoardSharingTx(firestore, tx), actor.uid, input),
  );
  return boardSharingResultSchema.parse(result);
});
