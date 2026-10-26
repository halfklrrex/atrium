import { bootstrapUserRequestSchema, bootstrapUserResultSchema } from '@atrium/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminBootstrapTx, db } from '../lib/admin';
import { bootstrapUserInTransaction, type Identity } from '../lib/bootstrap';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Called by the web app once after every sign-in. Creates `users/{uid}` and a personal workspace on
 * first use; afterwards simply returns the workspace to open.
 */
export const bootstrapUser = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.');
  }

  const parsed = bootstrapUserRequestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Invalid bootstrapUser request.', parsed.error.issues);
  }

  const { uid, token } = request.auth;
  const identity: Identity = {
    uid,
    displayName: str(token.name),
    email: str(token.email),
    photoURL: str(token.picture),
  };

  const firestore = db();
  const result = await firestore.runTransaction((tx) =>
    bootstrapUserInTransaction(
      adminBootstrapTx(firestore, tx),
      identity,
      parsed.data,
      FieldValue.serverTimestamp(),
    ),
  );

  return bootstrapUserResultSchema.parse(result);
});
