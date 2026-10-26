import { finalizeFileUploadRequestSchema, finalizeFileUploadResultSchema } from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFileStorageBucket, adminFileStorageTx, db } from '../lib/admin';
import { finalizeFileUploadInTransaction } from '../lib/file-storage';

export const finalizeFileUpload = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }

  const parsed = finalizeFileUploadRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid finalizeFileUpload request.',
      parsed.error.issues,
    );
  }

  const { uid } = request.auth;
  const firestore = db();
  const bucket = adminFileStorageBucket();

  const outcome = await firestore.runTransaction((tx) =>
    finalizeFileUploadInTransaction(adminFileStorageTx(firestore, tx), bucket, parsed.data, uid),
  );

  if (outcome.kind === 'rejected') {
    await bucket.deleteFile(outcome.storagePathToDelete);
    throw outcome.error;
  }

  return finalizeFileUploadResultSchema.parse({
    file: outcome.file,
    columnValue: outcome.columnValue,
  });
});
