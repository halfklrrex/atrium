import { revertColumnTypeRequestSchema, revertColumnTypeResultSchema } from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminColumnTypeChangeStore, db } from '../lib/admin';
import { revertColumnTypeLogic } from '../lib/column-type-change';

/** Undoes a column type change from its snapshot (values and column definition). */
export const revertColumnType = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to continue.');
    }
    const parsed = revertColumnTypeRequestSchema.safeParse(request.data ?? {});
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        'Invalid revertColumnType request.',
        parsed.error.issues,
      );
    }
    const result = await revertColumnTypeLogic(
      adminColumnTypeChangeStore(db()),
      request.auth.uid,
      parsed.data,
    );
    return revertColumnTypeResultSchema.parse(result);
  },
);
