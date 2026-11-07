import {
  requestUpdateAttachmentUploadRequestSchema,
  requestUpdateAttachmentUploadResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminFileStorageBucket, adminUpdateAttachmentTx, db } from '../lib/admin';
import { requestUpdateAttachmentUploadInTransaction } from '../lib/update-attachments';

export const requestUpdateAttachmentUpload = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const parsed = requestUpdateAttachmentUploadRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid requestUpdateAttachmentUpload request.',
      parsed.error.issues,
    );
  }
  const { uid } = actor;
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
