import { startTimeTrackingRequestSchema, startTimeTrackingResultSchema } from '@atrium/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminColumnActionsTx, db } from '../lib/admin';
import { startTimeTrackingInTransaction } from '../lib/column-actions';

export const startTimeTracking = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }

  const { uid } = request.auth;
  const parsed = startTimeTrackingRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Invalid startTimeTracking request.',
      parsed.error.issues,
    );
  }

  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    startTimeTrackingInTransaction(
      adminColumnActionsTx(firestore, tx),
      uid,
      parsed.data,
      FieldValue.serverTimestamp(),
    ),
  );

  return startTimeTrackingResultSchema.parse(result);
});
