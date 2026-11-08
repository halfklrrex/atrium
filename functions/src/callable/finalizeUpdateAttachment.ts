import {
  finalizeUpdateAttachmentRequestSchema,
  finalizeUpdateAttachmentResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminFileStorageBucket, adminUpdateAttachmentTx, db } from '../lib/admin';
import { finalizeUpdateAttachmentInTransaction } from '../lib/update-attachments';

export const finalizeUpdateAttachment = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const parsed = finalizeUpdateAttachmentRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid finalizeUpdateAttachment request.',
      parsed.error.issues,
    );
  }
  const { uid } = actor;
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
