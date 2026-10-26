/** Firebase errors carry a string `code` such as `auth/popup-blocked`. */
export function getErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** The user dismissed the popup themselves, so there is nothing to report. */
export function isSilentSignInError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
}

export const BOOTSTRAP_ERROR_MESSAGE =
  "We couldn't finish setting up your account. Please try again.";

/**
 * Friendly message for a failed Google sign-in, or `null` when no message should be shown
 * (the user closed the popup). Unknown errors get the generic message; callers log the code.
 */
export function signInErrorMessage(error: unknown): string | null {
  if (isSilentSignInError(error)) return null;
  switch (getErrorCode(error)) {
    case 'auth/unauthorized-domain':
      return "This address isn't allowed to sign in yet.";
    case 'auth/network-request-failed':
      return 'Check your connection and try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

const KNOWN_CODES = new Set(['auth/unauthorized-domain', 'auth/network-request-failed']);

/** True when the error is one we have a dedicated message for (so it needs no console log). */
export function isKnownSignInError(error: unknown): boolean {
  const code = getErrorCode(error);
  return isSilentSignInError(error) || (code !== undefined && KNOWN_CODES.has(code));
}
