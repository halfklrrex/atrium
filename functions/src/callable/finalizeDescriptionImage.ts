import {
  finalizeDescriptionImageRequestSchema,
  finalizeDescriptionImageResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminDescriptionImageTx, adminFileStorageBucket, db } from '../lib/admin';
import { finalizeDescriptionImageInTransaction } from '../lib/description-images';

export const finalizeDescriptionImage = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  const parsed = finalizeDescriptionImageRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid finalizeDescriptionImage request.',
      parsed.error.issues,
    );
  }
  const { uid } = request.auth;
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
