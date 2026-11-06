import {
  requestUpdateAttachmentUploadRequestSchema,
  requestUpdateAttachmentUploadResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFileStorageBucket, adminUpdateAttachmentTx, db } from '../lib/admin';
import { requestUpdateAttachmentUploadInTransaction } from '../lib/update-attachments';

export const requestUpdateAttachmentUpload = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  const parsed = requestUpdateAttachmentUploadRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid requestUpdateAttachmentUpload request.',
      parsed.error.issues,
    );
  }
  const { uid } = request.auth;
  const firestore = db();
  const bucket = adminFileStorageBucket();
  const result = await firestore.runTransaction((tx) =>
    requestUpdateAttachmentUploadInTransaction(
      adminUpdateAttachmentTx(firestore, tx),
      bucket,
      parsed.data,
      uid,
    ),
  );
  return requestUpdateAttachmentUploadResultSchema.parse(result);
});
