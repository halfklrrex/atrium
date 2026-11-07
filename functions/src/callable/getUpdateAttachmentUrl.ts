import {
  getUpdateAttachmentUrlRequestSchema,
  getUpdateAttachmentUrlResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminFileStorageBucket, adminUpdateAttachmentTx, db } from '../lib/admin';
import { getUpdateAttachmentUrlInTransaction } from '../lib/update-attachments';

export const getUpdateAttachmentUrl = onCall(async (request) => {
  const actor = actorFromRequest(request);
  const parsed = getUpdateAttachmentUrlRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid getUpdateAttachmentUrl request.',
      parsed.error.issues,
    );
  }
  const { uid } = actor;
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
