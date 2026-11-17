import { finalizeDocImageRequestSchema, finalizeDocImageResultSchema } from '@atrium/shared';
import { onCall } from 'firebase-functions/v2/https';
import { actorFromRequest, parseInput } from '../lib/actor';
import { adminDocImageTx, adminFileStorageBucket, db } from '../lib/admin';
import { finalizeDocImageInTransaction } from '../lib/doc-images';

/** Checks an uploaded doc image and lists it on the doc (doc editors only). */
export const finalizeDocImage = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const input = parseInput(finalizeDocImageRequestSchema, request.data, 'finalizeDocImage');
  const firestore = db();
  const bucket = adminFileStorageBucket();
  const outcome = await firestore.runTransaction((tx) =>
    finalizeDocImageInTransaction(adminDocImageTx(firestore, tx), bucket, input, actor.uid),
  );
  if (outcome.kind === 'rejected') {
    await bucket.deleteFile(outcome.storagePathToDelete);
    throw outcome.error;
  }
  return finalizeDocImageResultSchema.parse(outcome.result);
});
