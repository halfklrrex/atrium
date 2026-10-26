import { requestFileUploadRequestSchema, requestFileUploadResultSchema } from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFileStorageBucket, adminFileStorageTx, db } from '../lib/admin';
import { requestFileUploadInTransaction } from '../lib/file-storage';

export const requestFileUpload = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }

  const parsed = requestFileUploadRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid requestFileUpload request.',
      parsed.error.issues,
    );
  }

  const { uid } = request.auth;
  const firestore = db();
  const bucket = adminFileStorageBucket();

  const result = await firestore.runTransaction((tx) =>
    requestFileUploadInTransaction(adminFileStorageTx(firestore, tx), bucket, parsed.data, uid),
  );

  return requestFileUploadResultSchema.parse(result);
});
