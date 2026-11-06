import {
  bootstrapUserRequestSchema,
  bootstrapUserResultSchema,
  type AccountStatus,
} from '@atrium/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { actorFromRequest } from '../lib/actor';
import { adminBootstrapTx, db } from '../lib/admin';
import { afterUserCreated, healApprovedClaim } from '../lib/account-admin';
import { isApprovalRequired } from '../lib/account-flag';
import { adminAccountAuth } from '../lib/admin-account';
import { adminNotificationStore } from '../lib/admin-notifications';
import { bootstrapUserInTransaction, type Identity } from '../lib/bootstrap';
import { syncMemberProfiles } from '../lib/membership';
import { adminMemberProfileStore } from '../lib/membership-admin';

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
  const approvalRequired = isApprovalRequired();
  let created = false;
  const result = await firestore.runTransaction((tx) => {
    created = false; // the transaction body can run more than once
    return bootstrapUserInTransaction(
      adminBootstrapTx(firestore, tx),
      identity,
      parsed.data,
      FieldValue.serverTimestamp(),
      {
        approvalRequired,
        onUserCreated: () => {
          created = true;
        },
      },
    );
  });

  // New account only (existing users are never touched): approve it with a claim, or tell the
  // admins. Best effort: a failure here must never break sign-in.
  if (created) {
    try {
      await afterUserCreated(
        {
          auth: adminAccountAuth(),
          createNotification: (to, id, data) =>
            adminNotificationStore(firestore).createNotification(to, id, data),
        },
        identity,
        approvalRequired,
      );
    } catch (error) {
      logger.error('Account setup after sign-up failed', { uid, approvalRequired, error });
    }
  }

  // Existing account whose token has no `acct` claim (it slipped through the backfill): give it the
  // approved claim now, so it heals on this sign-in. Only for an approved (or status-less, flag off)
  // profile; best effort, never breaks sign-in. The web app force-refreshes its token afterwards.
  if (!created && token.acct === undefined) {
    try {
      const profile = await firestore.doc(`users/${uid}`).get();
      const status = profile.get('accountStatus') as AccountStatus | undefined;
      await healApprovedClaim({ auth: adminAccountAuth() }, uid, status, approvalRequired);
    } catch (error) {
      logger.error('Could not set the approved claim on sign-in', { uid, error });
    }
  }

  // Keep the caller's name and photo current on their member docs (best effort, never blocks sign-in).
  try {
    await syncMemberProfiles(adminMemberProfileStore(firestore), actorFromRequest(request));
  } catch (error) {
    logger.warn('Member profile sync failed', error);
  }

  return bootstrapUserResultSchema.parse(result);
});
