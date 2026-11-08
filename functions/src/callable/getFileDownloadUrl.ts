import { getFileDownloadUrlRequestSchema, getFileDownloadUrlResultSchema } from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminFileStorageBucket, adminFileStorageTx, db } from '../lib/admin';
import { getFileDownloadUrlInTransaction } from '../lib/file-storage';

export const getFileDownloadUrl = onCall(async (request) => {
  const actor = actorFromRequest(request);

  const parsed = getFileDownloadUrlRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid getFileDownloadUrl request.',
      parsed.error.issues,
    );
  }

  const { uid } = actor;
  const firestore = db();
  const bucket = adminFileStorageBucket();

  const result = await firestore.runTransaction((tx) =>
    getFileDownloadUrlInTransaction(adminFileStorageTx(firestore, tx), bucket, parsed.data, uid),
  );

  return getFileDownloadUrlResultSchema.parse(result);
});
