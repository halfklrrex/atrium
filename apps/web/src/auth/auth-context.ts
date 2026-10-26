import type { User } from 'firebase/auth';
import { createContext, useContext } from 'react';

/**
 * `loading`       - waiting for Firebase Auth to restore the session
 * `signedOut`     - no user
 * `bootstrapping` - signed in, `bootstrapUser` call in flight
 * `ready`         - signed in and bootstrapped; `lastWorkspaceId` is set
 * `error`         - signed in but bootstrap failed (see `error`, retry or sign out)
 */
export type AuthStatus = 'loading' | 'signedOut' | 'bootstrapping' | 'ready' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** Workspace to open when landing on `/`; kept current as the user switches workspaces. */
  lastWorkspaceId: string | null;
  /** The `bootstrapUser` failure while `status` is `error`. */
  error: Error | null;
  /** A failed sign-in that finished after a redirect (popup fallback); cleared on the next attempt. */
  redirectError: unknown;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  retryBootstrap: () => void;
  /** Remember the workspace the user is looking at (local state + `users/{uid}.lastWorkspaceId`). */
  rememberWorkspace: (workspaceId: string) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
