import { z } from 'zod';

/**
 * Site admin role (docs/specs/ADMIN-site-admin-role.md): every account is pending, approved or
 * blocked. The state is server-owned: it lives in `users/{uid}.accountStatus` and, for the rules, in
 * a custom auth claim. Clients never write either.
 */
export const accountStatusSchema = z.enum(['pending', 'approved', 'blocked']);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

/** Name of the custom claim that carries an approved or blocked status. A missing claim means pending. */
export const ACCOUNT_CLAIM = 'acct';
/** Name of the custom claim that marks a site admin. */
export const ADMIN_CLAIM = 'admin';

/** Value of the `acct` claim (a pending account has no claim at all). */
export const accountClaimValueSchema = z.enum(['approved', 'blocked']);
export type AccountClaimValue = z.infer<typeof accountClaimValueSchema>;

/** The claims this feature owns on an Auth user. */
export const accountClaimsSchema = z.object({
  [ACCOUNT_CLAIM]: accountClaimValueSchema.optional(),
  [ADMIN_CLAIM]: z.literal(true).optional(),
});
export type AccountClaims = z.infer<typeof accountClaimsSchema>;

/** Fields of `users/{uid}` written only by Cloud Functions and scripts (optional: older users lack them). */
export const userAccountFieldsSchema = z.object({
  accountStatus: accountStatusSchema.optional(),
  statusChangedAt: z
    .custom<{ toMillis(): number }>(
      (v) =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as { toMillis?: unknown }).toMillis === 'function',
    )
    .optional(),
  /** A uid, or `system:<name>` for scripts and automatic changes. */
  statusChangedBy: z.string().max(128).optional(),
});
export type UserAccountFields = z.infer<typeof userAccountFieldsSchema>;

/** The keys of `users/{uid}` that clients can never write (mirrors firestore.rules and its tests). */
export const SERVER_OWNED_USER_FIELDS = [
  'accountStatus',
  'statusChangedAt',
  'statusChangedBy',
] as const;

type TokenLike = Record<string, unknown> | null | undefined;

/** The status a token stands for: `approved` or `blocked` from the claim, otherwise `pending`. */
export function accountStatusFromClaims(token: TokenLike): AccountStatus {
  const value = token?.[ACCOUNT_CLAIM];
  return value === 'approved' || value === 'blocked' ? value : 'pending';
}

/** True when the token carries `acct: 'approved'`. */
export function isApprovedClaims(token: TokenLike): boolean {
  return token?.[ACCOUNT_CLAIM] === 'approved';
}

/** True when the token carries `admin: true`. */
export function isAdminClaims(token: TokenLike): boolean {
  return token?.[ADMIN_CLAIM] === true;
}

/**
 * The claims to set for a status. `pending` has no `acct` claim, so the result is empty (plus
 * `admin: true` for an admin). Merge into the user's other claims, replacing the two owned keys.
 */
export function claimsForStatus(status: AccountStatus, admin = false): AccountClaims {
  const claims: AccountClaims = {};
  if (status !== 'pending') claims[ACCOUNT_CLAIM] = status;
  if (admin) claims[ADMIN_CLAIM] = true;
  return claims;
}

/**
 * Existing custom claims with this feature's keys replaced for `status` (other claims untouched).
 * `admin` defaults to keeping whatever the user already has.
 */
export function mergeAccountClaims(
  existing: Record<string, unknown> | null | undefined,
  status: AccountStatus,
  admin: boolean = isAdminClaims(existing),
): Record<string, unknown> {
  const rest = { ...(existing ?? {}) };
  delete rest[ACCOUNT_CLAIM];
  delete rest[ADMIN_CLAIM];
  return { ...rest, ...claimsForStatus(status, admin) };
}
