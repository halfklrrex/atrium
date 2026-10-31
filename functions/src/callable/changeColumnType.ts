import { changeColumnTypeRequestSchema, changeColumnTypeResultSchema } from '@atrium/shared';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminColumnTypeChangeStore, db } from '../lib/admin';
import { changeColumnTypeLogic } from '../lib/column-type-change';

/**
 * Changes a column's type and converts its values (P2 "Change a column's type"). Large boards need
 * time: every 400 items are one batch, so give it the longest callable timeout.
 */
export const changeColumnType = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to continue.');
    }
    const parsed = changeColumnTypeRequestSchema.safeParse(request.data ?? {});
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        'Invalid changeColumnType request.',
        parsed.error.issues,
      );
    }
    const result = await changeColumnTypeLogic(
      adminColumnTypeChangeStore(db()),
      request.auth.uid,
      parsed.data,
    );
    return changeColumnTypeResultSchema.parse(result);
  },
);
