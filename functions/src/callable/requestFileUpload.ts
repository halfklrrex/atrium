import { requestFileUploadRequestSchema, requestFileUploadResultSchema } from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminFileStorageBucket, adminFileStorageTx, db } from '../lib/admin';
import { requestFileUploadInTransaction } from '../lib/file-storage';

export const requestFileUpload = onCall(async (request) => {
  const actor = actorFromRequest(request);

  const parsed = requestFileUploadRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid requestFileUpload request.',
      parsed.error.issues,
    );
  }

  const { uid } = actor;
  const firestore = db();
  const bucket = adminFileStorageBucket();

  const result = await firestore.runTransaction((tx) =>
    requestFileUploadInTransaction(adminFileStorageTx(firestore, tx), bucket, parsed.data, uid),
  );

  return requestFileUploadResultSchema.parse(result);
});
