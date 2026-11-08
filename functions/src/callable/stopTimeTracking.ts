import { stopTimeTrackingRequestSchema, stopTimeTrackingResultSchema } from '@atrium/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminColumnActionsTx, db } from '../lib/admin';
import { stopTimeTrackingInTransaction } from '../lib/column-actions';

export const stopTimeTracking = onCall(async (request) => {
  const { uid } = actorFromRequest(request);
  const parsed = stopTimeTrackingRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid stopTimeTracking request.',
      parsed.error.issues,
    );
  }

  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    stopTimeTrackingInTransaction(
      adminColumnActionsTx(firestore, tx),
      uid,
      parsed.data,
      FieldValue.serverTimestamp(),
    ),
  );

  return stopTimeTrackingResultSchema.parse(result);
});
