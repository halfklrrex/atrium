import { defineBoolean } from 'firebase-functions/params';

/**
 * ADMIN-2 safety switch (docs/specs/ADMIN-site-admin-role.md). Off by default: sign-in behaves as
 * before and new accounts are created already approved. On: a new account is `pending`, has no
 * workspace, and the admins are told. Flip it only after the gate has shipped, with
 * `ACCOUNT_APPROVAL_REQUIRED=true` in `functions/.env.<project>`.
 */
export const ACCOUNT_APPROVAL_REQUIRED = defineBoolean('ACCOUNT_APPROVAL_REQUIRED', {
  default: false,
  description: 'Hold new sign-ups as pending until a site admin approves them.',
});

/** Read through a function so tests can stand in for it. Call at request time, never at import. */
export const isApprovalRequired = (): boolean => ACCOUNT_APPROVAL_REQUIRED.value();
