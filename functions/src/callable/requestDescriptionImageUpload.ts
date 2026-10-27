import {
  requestDescriptionImageUploadRequestSchema,
  requestDescriptionImageUploadResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminDescriptionImageTx, adminFileStorageBucket, db } from '../lib/admin';
import { requestDescriptionImageUploadInTransaction } from '../lib/description-images';

export const requestDescriptionImageUpload = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  const parsed = requestDescriptionImageUploadRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid requestDescriptionImageUpload request.',
      parsed.error.issues,
    );
  }
  const { uid } = request.auth;
  const firestore = db();
  const bucket = adminFileStorageBucket();
  const result = await firestore.runTransaction((tx) =>
    requestDescriptionImageUploadInTransaction(
      adminDescriptionImageTx(firestore, tx),
      bucket,
      parsed.data,
      uid,
    ),
  );
  return requestDescriptionImageUploadResultSchema.parse(result);
});
