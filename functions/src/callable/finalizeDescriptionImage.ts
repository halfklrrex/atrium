import {
  finalizeDescriptionImageRequestSchema,
  finalizeDescriptionImageResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminDescriptionImageTx, adminFileStorageBucket, db } from '../lib/admin';
import { finalizeDescriptionImageInTransaction } from '../lib/description-images';

export const finalizeDescriptionImage = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const parsed = finalizeDescriptionImageRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid finalizeDescriptionImage request.',
      parsed.error.issues,
    );
  }
  const { uid } = actor;
  const firestore = db();
  const bucket = adminFileStorageBucket();
  const outcome = await firestore.runTransaction((tx) =>
    finalizeDescriptionImageInTransaction(
      adminDescriptionImageTx(firestore, tx),
      bucket,
      parsed.data,
      uid,
    ),
  );
  if (outcome.kind === 'rejected') {
    await bucket.deleteFile(outcome.storagePathToDelete);
    throw outcome.error;
  }
  return finalizeDescriptionImageResultSchema.parse(outcome.result);
});
