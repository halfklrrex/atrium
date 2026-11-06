/**
 * ADMIN-2 safety switch (docs/specs/ADMIN-site-admin-role.md). Off by default: sign-in behaves as
 * before and new accounts are created already approved. On: a new account is `pending`, has no
 * workspace, and the admins are told. Flip it only after the gate has shipped, with
 * `ACCOUNT_APPROVAL_REQUIRED=true` in `functions/.env.<project>` (a plain environment variable).
 *
 * It is deliberately NOT a `defineBoolean` param: a param makes `firebase deploy` demand a value in
 * non-interactive mode (the CI deploy failed on that, even with a default), while an unset
 * environment variable simply reads as off.
 */
export const isApprovalRequired = (): boolean =>
  process.env.ACCOUNT_APPROVAL_REQUIRED?.trim().toLowerCase() === 'true';
