import { describe, expect, it } from 'vitest';
import { ACCOUNT_DISABLED_MESSAGE, isKnownSignInError, signInErrorMessage } from './auth-errors';

const err = (code: string) => Object.assign(new Error('x'), { code });

describe('signInErrorMessage', () => {
  it('explains a disabled (blocked) account', () => {
    expect(signInErrorMessage(err('auth/user-disabled'))).toBe(ACCOUNT_DISABLED_MESSAGE);
    expect(ACCOUNT_DISABLED_MESSAGE).toBe(
      'Your account has been disabled. If you think this is an error, contact the site admin.',
    );
    expect(isKnownSignInError(err('auth/user-disabled'))).toBe(true);
  });

  it('leaves the other codes unchanged', () => {
    expect(signInErrorMessage(err('auth/unauthorized-domain'))).toBe(
      "This address isn't allowed to sign in yet.",
    );
    expect(signInErrorMessage(err('auth/network-request-failed'))).toBe(
      'Check your connection and try again.',
    );
    expect(signInErrorMessage(err('auth/popup-closed-by-user'))).toBeNull();
    expect(signInErrorMessage(err('auth/internal-error'))).toBe(
      'Sign-in failed. Please try again.',
    );
    expect(isKnownSignInError(err('auth/internal-error'))).toBe(false);
  });
});
