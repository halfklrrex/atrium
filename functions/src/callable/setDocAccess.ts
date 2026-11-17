import { DOC_LIMITS, boardSharingResultSchema, setDocAccessRequestSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { adminDocSharingTx, db } from '../lib/admin';
import { setEntityAccessInTransaction } from '../lib/entity-sharing';

/** Changes a doc's kind and/or one person's access to it (doc owners only). */
export const setDocAccess = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(setDocAccessRequestSchema, request.data, 'setDocAccess');
  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    setEntityAccessInTransaction(
      { noun: 'doc', accessEntries: DOC_LIMITS.accessEntries },
      adminDocSharingTx(firestore, tx),
      actor.uid,
      { id: input.docId, kind: input.kind, person: input.person },
    ),
  );
  return boardSharingResultSchema.parse(result);
});
