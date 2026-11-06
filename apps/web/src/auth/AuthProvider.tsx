import type { AccountStatus } from '@atrium/shared';
import {
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { writes } from '../data/firestore';
import { callBootstrapUser } from '../lib/callables';
import { auth } from '../lib/firebase';
import { getErrorCode, isSilentSignInError } from './auth-errors';
import { ensureApprovedToken } from './ensure-approved-token';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** A Firebase auth session. `number` increments on every sign-in so each one gets its own bootstrap. */
interface Session {
  id: number;
  user: User | null;
}

interface BootstrapOutcome {
  /** `${session}:${attempt}` this outcome belongs to. */
  key: string;
  workspaceId: string | null;
  accountStatus: AccountStatus | null;
  error: Error | null;
}

/**
 * Owns the auth session. Every time a user session starts (sign-in, or page load with a restored
 * session) it calls the idempotent `bootstrapUser` callable and exposes the workspace to open.
 * Status is derived from three small pieces of state so no effect has to set state synchronously.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null); // null = Firebase not resolved yet
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<BootstrapOutcome | null>(null);
  const [remembered, setRemembered] = useState<{ uid: string; workspaceId: string } | null>(null);
  const [redirectError, setRedirectError] = useState<unknown>(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => setSession((prev) => ({ id: (prev?.id ?? 0) + 1, user }))),
    [],
  );

  // Finish a sign-in that fell back to `signInWithRedirect` (popup blocked). On success the
  // session arrives through onAuthStateChanged; only a failure needs surfacing here.
  useEffect(() => {
    getRedirectResult(auth).catch((e: unknown) => {
      if (isSilentSignInError(e)) return;
      console.error('Google sign-in redirect failed', getErrorCode(e), e);
      setRedirectError(e);
    });
  }, []);

  const user = session?.user ?? null;
  const key = user && session ? `${session.id}:${attempt}` : null;

  // The bootstrap effect reads the user and session through refs so it re-runs only per `key`.
  const userRef = useRef<User | null>(null);
  const sessionIdRef = useRef(0);
  // Sessions whose ID token was already force-refreshed once for the account gate (loop guard).
  const refreshedSessions = useRef(new Set<number>());
  useEffect(() => {
    userRef.current = user;
    sessionIdRef.current = session?.id ?? 0;
  }, [user, session?.id]);

  // Bootstrap whenever a session with a user starts, or the user retries.
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    callBootstrapUser().then(
      async ({ workspaceId, accountStatus }) => {
        // Rules need the `acct` claim in the token before any data subscription starts. Once per
        // session; a failure is logged inside and never blocks sign-in.
        const current = userRef.current;
        const sessionId = sessionIdRef.current;
        if (current && !refreshedSessions.current.has(sessionId)) {
          refreshedSessions.current.add(sessionId);
          await ensureApprovedToken(current, accountStatus);
        }
        if (!cancelled) {
          setOutcome({
            key,
            workspaceId: workspaceId ?? null,
            accountStatus: accountStatus ?? null,
            error: null,
          });
        }
      },
      (e: unknown) => {
        if (cancelled) return;
        console.error('bootstrapUser failed', getErrorCode(e) ?? '', toError(e).message);
        setOutcome({ key, workspaceId: null, accountStatus: null, error: toError(e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = outcome && outcome.key === key ? outcome : null;
  let status: AuthStatus;
  if (!session) status = 'loading';
  else if (!user) status = 'signedOut';
  else if (!current) status = 'bootstrapping';
  else status = current.error ? 'error' : 'ready';

  const uid = user?.uid ?? null;
  const lastWorkspaceId =
    status !== 'ready'
      ? null
      : remembered?.uid === uid
        ? remembered.workspaceId
        : current!.workspaceId;

  const signInWithGoogle = useCallback(async () => {
    setRedirectError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      // Popups can be blocked (in-app browsers, strict settings): continue in this tab instead.
      if (getErrorCode(e) !== 'auth/popup-blocked') throw e;
      await signInWithRedirect(auth, provider);
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const retryBootstrap = useCallback(() => setAttempt((n) => n + 1), []);

  // A pending account was approved: the new claim only applies after a token refresh.
  const refreshAccount = useCallback(async () => {
    await user?.getIdToken(true);
    setAttempt((n) => n + 1);
  }, [user]);

  const rememberWorkspace = useCallback(
    (workspaceId: string) => {
      if (!uid) return;
      setRemembered({ uid, workspaceId });
      // Best effort: a failed write only means we reopen the previous workspace next time.
      writes.updateUserProfile(uid, { lastWorkspaceId: workspaceId }).catch((e: unknown) => {
        console.warn('Could not save last workspace', e);
      });
    },
    [uid],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      lastWorkspaceId,
      accountStatus: current?.accountStatus ?? null,
      refreshAccount,
      error: current?.error ?? null,
      redirectError,
      signInWithGoogle,
      signOut,
      retryBootstrap,
      rememberWorkspace,
    }),
    [
      status,
      user,
      lastWorkspaceId,
      current?.accountStatus,
      refreshAccount,
      current?.error,
      redirectError,
      signInWithGoogle,
      signOut,
      retryBootstrap,
      rememberWorkspace,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
