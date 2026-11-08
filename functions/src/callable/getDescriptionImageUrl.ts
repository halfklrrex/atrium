import {
  getDescriptionImageUrlRequestSchema,
  getDescriptionImageUrlResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminDescriptionImageTx, adminFileStorageBucket, db } from '../lib/admin';
import { getDescriptionImageUrlInTransaction } from '../lib/description-images';

export const getDescriptionImageUrl = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const parsed = getDescriptionImageUrlRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid getDescriptionImageUrl request.',
      parsed.error.issues,
    );
  }
  const { uid } = actor;
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
