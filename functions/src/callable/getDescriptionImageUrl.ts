import {
  getDescriptionImageUrlRequestSchema,
  getDescriptionImageUrlResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminDescriptionImageTx, adminFileStorageBucket, db } from '../lib/admin';
import { getDescriptionImageUrlInTransaction } from '../lib/description-images';

export const getDescriptionImageUrl = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  const parsed = getDescriptionImageUrlRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid getDescriptionImageUrl request.',
      parsed.error.issues,
    );
  }
  const { uid } = request.auth;
  const firestore = db();
  const bucket = adminFileStorageBucket();
  const result = await firestore.runTransaction((tx) =>
    getDescriptionImageUrlInTransaction(
      adminDescriptionImageTx(firestore, tx),
      bucket,
      parsed.data,
      uid,
    ),
  );
  return getDescriptionImageUrlResultSchema.parse(result);
});
