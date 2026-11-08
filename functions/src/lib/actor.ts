import { accountStatusFromClaims, type AccountStatus, type InboxErrorReason } from '@atrium/shared';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { ZodType } from 'zod';
import type { Actor } from './membership';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The verified caller, plus the account state and claims of the token that made the call. */
export interface CallerActor extends Actor {
  /** From the token's `acct` claim: approved, blocked, or pending (no claim). */
  accountStatus: AccountStatus;
  /** The verified token claims (for `assertAdminToken`); never anything the client sent. */
  claims: Readonly<Record<string, unknown>>;
}

export interface ActorOptions {
  /**
   * Account states allowed to call. Defaults to `['approved']`. An opt-out is allowed only for
   * `bootstrapUser` and `sendInboxMessage`; `approved-only.test.ts` enforces the allowlist
   * (docs/specs/ADMIN-4-appeals-inbox.md, "Central approved only check for callables").
   */
  allow?: ReadonlyArray<AccountStatus>;
}

const NOT_APPROVED_REASON: InboxErrorReason = 'account-not-approved';

/**
 * Verified caller identity from the Auth token; throws `unauthenticated` when signed out and
 * `permission-denied` (reason `account-not-approved`) when the account state is not allowed.
 */
export function actorFromRequest(
  request: CallableRequest,
  options: ActorOptions = {},
): CallerActor {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  const { uid, token } = request.auth;
  const claims = token as unknown as Record<string, unknown>;
  const accountStatus = accountStatusFromClaims(claims);
  const allow = options.allow ?? ['approved'];
  if (!allow.includes(accountStatus)) {
    throw new HttpsError('permission-denied', "Your account can't do this.", {
      reason: NOT_APPROVED_REASON,
      status: accountStatus,
    });
  }
  return {
    uid,
    email: str(token.email),
    emailVerified: token.email_verified === true,
    displayName: str(token.name),
    photoURL: str(token.picture),
    accountStatus,
    claims,
  };
}

/** Parses callable input with a zod schema, mapping failures to `invalid-argument`. */
export function parseInput<Out>(schema: ZodType<Out>, data: unknown, name: string): Out {
  const parsed = schema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', `Invalid ${name} request.`, parsed.error.issues);
  }
  return parsed.data;
}
