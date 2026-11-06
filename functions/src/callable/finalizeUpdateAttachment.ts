import {
  finalizeUpdateAttachmentRequestSchema,
  finalizeUpdateAttachmentResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFileStorageBucket, adminUpdateAttachmentTx, db } from '../lib/admin';
import { finalizeUpdateAttachmentInTransaction } from '../lib/update-attachments';

export const finalizeUpdateAttachment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }
  const parsed = finalizeUpdateAttachmentRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid finalizeUpdateAttachment request.',
      parsed.error.issues,
    );
  }
  const { uid } = request.auth;
  const firestore = db();
  const bucket = adminFileStorageBucket();
  const outcome = await firestore.runTransaction((tx) =>
    finalizeUpdateAttachmentInTransaction(
      adminUpdateAttachmentTx(firestore, tx),
      bucket,
      parsed.data,
      uid,
    ),
  );
  if (outcome.kind === 'rejected') {
    // Strictly after the transaction: a retried transaction body must never delete anything.
    await bucket.deleteFile(outcome.storagePathToDelete);
    throw outcome.error;
  }
  return finalizeUpdateAttachmentResultSchema.parse(outcome.result);
});
