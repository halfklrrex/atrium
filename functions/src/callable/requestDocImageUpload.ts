import {
  requestDocImageUploadRequestSchema,
  requestDocImageUploadResultSchema,
} from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { adminDocImageTx, adminFileStorageBucket, db } from '../lib/admin';
import { requestDocImageUploadInTransaction } from '../lib/doc-images';

/** A signed upload URL for one image of a doc (doc editors only). */
export const requestDocImageUpload = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(
    requestDocImageUploadRequestSchema,
    request.data,
    'requestDocImageUpload',
  );
  const firestore = db();
  const bucket = adminFileStorageBucket();
  const result = await firestore.runTransaction((tx) =>
    requestDocImageUploadInTransaction(adminDocImageTx(firestore, tx), bucket, input, actor.uid),
  );
  return requestDocImageUploadResultSchema.parse(result);
});
