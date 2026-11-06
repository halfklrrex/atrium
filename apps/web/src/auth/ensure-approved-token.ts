import { isApprovedClaims, type AccountStatus } from '@atrium/shared';
import type { User } from 'firebase/auth';

/**
 * ADMIN-1b: the Firestore rules read the `acct` claim from the ID token. A session that pre-dates
 * the claim (or whose account was approved a moment ago) holds a token without it, so reads would
 * be refused until the token's natural refresh, up to an hour later. When the server says the
 * account is approved (or reports no status at all, which means approved) but the token lacks the
 * claim, force one refresh. Best effort: it never throws and never blocks sign-in.
 *
 * Returns true when it refreshed the token.
 */
export async function ensureApprovedToken(
  user: Pick<User, 'getIdToken' | 'getIdTokenResult'>,
  accountStatus: AccountStatus | null | undefined,
): Promise<boolean> {
  if (accountStatus === 'pending' || accountStatus === 'blocked') return false;
  try {
    const { claims } = await user.getIdTokenResult();
    if (isApprovedClaims(claims)) return false;
    await user.getIdToken(true);
    return true;
  } catch (e) {
    console.warn('Could not refresh the ID token', e);
    return false;
  }
}
