import { getFileDownloadUrlRequestSchema, getFileDownloadUrlResultSchema } from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFileStorageBucket, adminFileStorageTx, db } from '../lib/admin';
import { getFileDownloadUrlInTransaction } from '../lib/file-storage';

export const getFileDownloadUrl = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }

  const parsed = getFileDownloadUrlRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid getFileDownloadUrl request.',
      parsed.error.issues,
    );
  }

  const { uid } = request.auth;
  const firestore = db();
  const bucket = adminFileStorageBucket();

  const result = await firestore.runTransaction((tx) =>
    getFileDownloadUrlInTransaction(adminFileStorageTx(firestore, tx), bucket, parsed.data, uid),
  );

  return getFileDownloadUrlResultSchema.parse(result);
});
