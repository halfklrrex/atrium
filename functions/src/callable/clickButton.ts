import { clickButtonRequestSchema, clickButtonResultSchema } from '@atrium/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminColumnActionsTx, db } from '../lib/admin';
import { clickButtonInTransaction } from '../lib/column-actions';

export const clickButton = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }

  const { uid } = request.auth;
  const parsed = clickButtonRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid clickButton request.', parsed.error.issues);
  }

  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    clickButtonInTransaction(
      adminColumnActionsTx(firestore, tx),
      uid,
      parsed.data,
      FieldValue.serverTimestamp(),
    ),
  );

  return clickButtonResultSchema.parse(result);
});
