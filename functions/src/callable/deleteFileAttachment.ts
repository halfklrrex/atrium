import {
  deleteFileAttachmentRequestSchema,
  deleteFileAttachmentResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFileStorageBucket, adminFileStorageTx, db } from '../lib/admin';
import { deleteFileAttachmentInTransaction } from '../lib/file-storage';

export const deleteFileAttachment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }

  const parsed = deleteFileAttachmentRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid deleteFileAttachment request.',
      parsed.error.issues,
    );
  }

  const { uid } = request.auth;
  const firestore = db();
  const bucket = adminFileStorageBucket();

  const { result, storagePathToDelete } = await firestore.runTransaction((tx) =>
    deleteFileAttachmentInTransaction(adminFileStorageTx(firestore, tx), parsed.data, uid),
  );

  await bucket.deleteFile(storagePathToDelete);

  return deleteFileAttachmentResultSchema.parse(result);
});
