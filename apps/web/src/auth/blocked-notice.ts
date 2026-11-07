/**
 * One-shot notice for the login page after the app signed a blocked person out (ADMIN-4 PR3). The
 * flag lives in `sessionStorage` so it survives the redirect to /login but not the tab. Storage can
 * be unavailable (private windows, blocked site data), so every access is guarded.
 */
const KEY = 'atrium.accountBlockedNotice';

export const ACCOUNT_BLOCKED_NOTICE =
  'Your account was blocked. Sign in again to see why and to send an appeal.';

export function setBlockedNotice(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // The notice is a courtesy; signing out matters more.
  }
}

/** Reads the flag without clearing it (safe to call twice, e.g. in StrictMode). */
export function hasBlockedNotice(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function clearBlockedNotice(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
