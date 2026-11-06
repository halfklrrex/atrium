import {
  getUpdateAttachmentUrlRequestSchema,
  getUpdateAttachmentUrlResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFileStorageBucket, adminUpdateAttachmentTx, db } from '../lib/admin';
import { getUpdateAttachmentUrlInTransaction } from '../lib/update-attachments';

export const getUpdateAttachmentUrl = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  const parsed = getUpdateAttachmentUrlRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid getUpdateAttachmentUrl request.',
      parsed.error.issues,
    );
  }
  const { uid } = request.auth;
  const firestore = db();
  const bucket = adminFileStorageBucket();
  const result = await firestore.runTransaction((tx) =>
    getUpdateAttachmentUrlInTransaction(
      adminUpdateAttachmentTx(firestore, tx),
      bucket,
      parsed.data,
      uid,
    ),
  );
  return getUpdateAttachmentUrlResultSchema.parse(result);
});
