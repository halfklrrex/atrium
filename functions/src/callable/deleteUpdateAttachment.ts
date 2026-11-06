import {
  deleteUpdateAttachmentRequestSchema,
  deleteUpdateAttachmentResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFileStorageBucket, adminUpdateAttachmentTx, db } from '../lib/admin';
import { deleteUpdateAttachmentInTransaction } from '../lib/update-attachments';

export const deleteUpdateAttachment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  const parsed = deleteUpdateAttachmentRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid deleteUpdateAttachment request.',
      parsed.error.issues,
    );
  }
  const { uid } = request.auth;
  const firestore = db();
  const bucket = adminFileStorageBucket();
  const { result, storagePathToDelete } = await firestore.runTransaction((tx) =>
    deleteUpdateAttachmentInTransaction(adminUpdateAttachmentTx(firestore, tx), parsed.data, uid),
  );
  await bucket.deleteFile(storagePathToDelete);
  return deleteUpdateAttachmentResultSchema.parse(result);
});
