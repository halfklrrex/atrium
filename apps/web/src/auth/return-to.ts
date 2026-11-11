const KEY = 'atrium:return-to';

/**
 * Remembers where a signed-out visitor was heading, for sign-in flows that reload the page
 * (the redirect fallback of Google sign-in loses the router state). Per tab.
 */
export function rememberReturnTo(pathname: string, search: string, hash: string): void {
  try {
    sessionStorage.setItem(KEY, `${pathname}${search}${hash}`);
  } catch {
    // Storage blocked: the router state still covers the popup flow.
  }
}

/** The remembered same-origin path, or null. Does not clear it; see `clearReturnTo`. */
export function peekReturnTo(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    return value && value.startsWith('/') && !value.startsWith('//') && value !== '/login'
      ? value
      : null;
  } catch {
    return null;
  }
}

export function clearReturnTo(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
