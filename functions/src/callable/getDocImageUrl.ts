import { getDocImageUrlRequestSchema, getDocImageUrlResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { adminDocImageTx, adminFileStorageBucket, db } from '../lib/admin';
import { getDocImageUrlInTransaction } from '../lib/doc-images';

/** A one-hour signed GET URL for an image the doc lists (anyone who can read the doc). */
export const getDocImageUrl = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(getDocImageUrlRequestSchema, request.data, 'getDocImageUrl');
  const firestore = db();
  const bucket = adminFileStorageBucket();
  const result = await firestore.runTransaction((tx) =>
    getDocImageUrlInTransaction(adminDocImageTx(firestore, tx), bucket, input, actor.uid),
  );
  return getDocImageUrlResultSchema.parse(result);
});
