import {
  deleteFileAttachmentRequestSchema,
  deleteFileAttachmentResultSchema,
} from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminFileStorageBucket, adminFileStorageTx, db } from '../lib/admin';
import { deleteFileAttachmentInTransaction } from '../lib/file-storage';

export const deleteFileAttachment = onCall(async (request) => {
  const actor = actorFromRequest(request);

  const parsed = deleteFileAttachmentRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid deleteFileAttachment request.',
      parsed.error.issues,
    );
  }

  const { uid } = actor;
  const firestore = db();
  const bucket = adminFileStorageBucket();

  const { result, storagePathToDelete } = await firestore.runTransaction((tx) =>
    deleteFileAttachmentInTransaction(adminFileStorageTx(firestore, tx), parsed.data, uid),
  );

  await bucket.deleteFile(storagePathToDelete);

  return deleteFileAttachmentResultSchema.parse(result);
});
