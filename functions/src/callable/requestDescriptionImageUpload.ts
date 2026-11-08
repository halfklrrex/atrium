import {
  requestDescriptionImageUploadRequestSchema,
  requestDescriptionImageUploadResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminDescriptionImageTx, adminFileStorageBucket, db } from '../lib/admin';
import { requestDescriptionImageUploadInTransaction } from '../lib/description-images';

export const requestDescriptionImageUpload = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const parsed = requestDescriptionImageUploadRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid requestDescriptionImageUpload request.',
      parsed.error.issues,
    );
  }
  const { uid } = actor;
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
