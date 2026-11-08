import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './auth-context';
import { hasBlockedNotice } from './blocked-notice';

const mocks = vi.hoisted(() => ({
  authListener: null as null | ((user: User | null) => void),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  callBootstrapUser: vi.fn(),
  signOut: vi.fn(),
  snapshot: null as null | ((snap: { data: () => unknown }) => void),
  unsubscribe: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth: unknown, cb: (user: User | null) => void) => {
    mocks.authListener = cb;
    return () => {};
  },
  signInWithPopup: mocks.signInWithPopup,
  signInWithRedirect: mocks.signInWithRedirect,
  getRedirectResult: mocks.getRedirectResult,
  signOut: mocks.signOut,
}));
vi.mock('firebase/firestore', () => ({ onSnapshot: mocks.onSnapshot }));
vi.mock('../lib/firebase', () => ({ auth: {} }));
vi.mock('../lib/callables', () => ({ callBootstrapUser: mocks.callBootstrapUser }));
vi.mock('../data/firestore', () => ({
  writes: { updateUserProfile: vi.fn() },
  plainRefs: { user: (uid: string) => ({ uid }) },
}));

function Probe() {
  const { status, accountStatus, refreshAccount, redirectError, signInWithGoogle, retryBootstrap } =
    useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="account">{accountStatus ?? 'none'}</p>
      <button onClick={() => void refreshAccount()}>refresh</button>
      <p data-testid="redirect-error">{String((redirectError as Error | null)?.message ?? '')}</p>
      <button onClick={() => void signInWithGoogle().catch(() => {})}>sign in</button>
      <button onClick={retryBootstrap}>retry</button>
    </div>
  );
}

const getIdToken = vi.fn();
const getIdTokenResult = vi.fn();
const fakeUser = { uid: 'u1', getIdToken, getIdTokenResult } as unknown as User;
const signInAs = () => act(() => mocks.authListener?.(fakeUser));

beforeEach(() => {
  mocks.authListener = null;
  mocks.snapshot = null;
  mocks.unsubscribe.mockReset();
  mocks.signOut.mockReset().mockResolvedValue(undefined);
  mocks.onSnapshot.mockReset().mockImplementation((_ref, next) => {
    mocks.snapshot = next;
    return mocks.unsubscribe;
  });
  sessionStorage.clear();
  mocks.getRedirectResult.mockResolvedValue(null);
  mocks.callBootstrapUser.mockResolvedValue({ workspaceId: 'w1' });
  getIdToken.mockReset();
  getIdTokenResult.mockReset();
  getIdTokenResult.mockResolvedValue({ claims: { acct: 'approved' } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  it('moves to error when bootstrapUser fails, logs it, and retry re-calls bootstrapUser only', async () => {
    const failure = Object.assign(new Error('internal'), { code: 'functions/internal' });
    mocks.callBootstrapUser.mockRejectedValueOnce(failure);
    renderProvider();
    await signInAs();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(console.error).toHaveBeenCalledWith(
      'bootstrapUser failed',
      'functions/internal',
      'internal',
    );
    expect(mocks.callBootstrapUser).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(mocks.callBootstrapUser).toHaveBeenCalledTimes(2);
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it('falls back to signInWithRedirect when the popup is blocked', async () => {
    mocks.signInWithPopup.mockRejectedValue(
      Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }),
    );
    mocks.signInWithRedirect.mockResolvedValue(undefined);
    renderProvider();
    await userEvent.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() => expect(mocks.signInWithRedirect).toHaveBeenCalledTimes(1));
  });

  it('does not redirect for other popup errors', async () => {
    mocks.signInWithPopup.mockRejectedValue(
      Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }),
    );
    renderProvider();
    await userEvent.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() => expect(mocks.signInWithPopup).toHaveBeenCalled());
    expect(mocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('reports no account status when the server does not send one', async () => {
    renderProvider();
    await signInAs();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
  });

  it('refreshAccount force-refreshes the token and re-bootstraps a pending account', async () => {
    mocks.callBootstrapUser.mockResolvedValueOnce({ accountStatus: 'pending' });
    getIdToken.mockResolvedValue('token');
    renderProvider();
    await signInAs();
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('pending'));

    await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(getIdToken).toHaveBeenCalledWith(true));
    await waitFor(() => expect(mocks.callBootstrapUser).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('account')).toHaveTextContent('none');
  });

  it('force-refreshes the token once when it lacks the approved claim, before status is ready', async () => {
    getIdTokenResult.mockResolvedValue({ claims: {} });
    getIdToken.mockResolvedValue('token');
    renderProvider();
    await signInAs();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(getIdToken).toHaveBeenCalledTimes(1);
    expect(getIdToken).toHaveBeenCalledWith(true);

    // A retry in the same session does not refresh again (loop guard).
    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(mocks.callBootstrapUser).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(getIdToken).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when the token already has the claim or the account is pending', async () => {
    mocks.callBootstrapUser.mockResolvedValueOnce({ accountStatus: 'pending' });
    getIdTokenResult.mockResolvedValue({ claims: {} });
    renderProvider();
    await signInAs();
    await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('pending'));
    expect(getIdToken).not.toHaveBeenCalled();
  });

  it('still signs in when the token refresh fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getIdTokenResult.mockResolvedValue({ claims: {} });
    getIdToken.mockRejectedValue(new Error('offline'));
    renderProvider();
    await signInAs();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
  });

  it('exposes a failed redirect result on load', async () => {
    mocks.getRedirectResult.mockRejectedValue(
      Object.assign(new Error('bad domain'), { code: 'auth/unauthorized-domain' }),
    );
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('redirect-error')).toHaveTextContent('bad domain'),
    );
  });

  describe('block while signed in (ADMIN-4)', () => {
    const snap = (accountStatus: string) =>
      act(() => mocks.snapshot?.({ data: () => ({ accountStatus }) }));

    async function approvedSession() {
      mocks.callBootstrapUser.mockResolvedValue({ workspaceId: 'w1', accountStatus: 'approved' });
      renderProvider();
      await signInAs();
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    }

    it('listens to the own user document while approved, and not for pending or blocked', async () => {
      await approvedSession();
      expect(mocks.onSnapshot).toHaveBeenCalledTimes(1);
      expect(mocks.onSnapshot.mock.calls[0]![0]).toEqual({ uid: 'u1' });
    });

    it('does not listen for a pending or a blocked account', async () => {
      mocks.callBootstrapUser.mockResolvedValue({ accountStatus: 'blocked' });
      renderProvider();
      await signInAs();
      await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('blocked'));
      expect(mocks.onSnapshot).not.toHaveBeenCalled();
    });

    it('signs out, sets the one-shot flag, and tries the refresh only once when the token is revoked', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await approvedSession();
      getIdToken.mockReset();
      getIdToken.mockRejectedValue(
        Object.assign(new Error('revoked'), { code: 'auth/user-token-expired' }),
      );
      snap('approved'); // other statuses do nothing
      expect(getIdToken).not.toHaveBeenCalled();
      snap('blocked');
      snap('blocked'); // a repeat snapshot of the same block is ignored
      await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
      expect(getIdToken).toHaveBeenCalledTimes(1);
      expect(getIdToken).toHaveBeenCalledWith(true);
      expect(hasBlockedNotice()).toBe(true);
    });

    it('re-runs the bootstrap and does not sign out when the refresh unexpectedly succeeds', async () => {
      await approvedSession();
      getIdToken.mockReset();
      getIdToken.mockResolvedValue('fresh');
      mocks.callBootstrapUser.mockResolvedValue({ accountStatus: 'blocked' });
      snap('blocked');
      snap('blocked');
      await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('blocked'));
      expect(mocks.callBootstrapUser).toHaveBeenCalledTimes(2);
      expect(getIdToken).toHaveBeenCalledTimes(1);
      expect(mocks.signOut).not.toHaveBeenCalled();
      expect(hasBlockedNotice()).toBe(false);
    });

    it('does not loop when the listener is re-attached while the same block is still reported', async () => {
      await approvedSession();
      getIdToken.mockReset();
      getIdToken.mockResolvedValue('fresh');
      // The bootstrap (wrongly) says approved again: the same block must not trigger a second attempt.
      mocks.callBootstrapUser.mockResolvedValue({ workspaceId: 'w1', accountStatus: 'approved' });
      snap('blocked');
      await waitFor(() => expect(mocks.callBootstrapUser).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(mocks.onSnapshot).toHaveBeenCalledTimes(2));
      snap('blocked');
      await new Promise((r) => setTimeout(r, 20));
      expect(getIdToken).toHaveBeenCalledTimes(1);
      expect(mocks.callBootstrapUser).toHaveBeenCalledTimes(2);
    });

    it('stops listening when the session ends', async () => {
      await approvedSession();
      act(() => mocks.authListener?.(null));
      await waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalled());
    });
  });

  describe('refreshAccount claim retry', () => {
    afterEach(() => vi.useRealTimers());

    it('retries up to 5 times, 1 second apart, until the claim is approved', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mocks.callBootstrapUser.mockResolvedValueOnce({ accountStatus: 'blocked' });
      getIdToken.mockResolvedValue('token');
      // The claim is still old for 3 checks, then approved.
      getIdTokenResult
        .mockResolvedValueOnce({ claims: { acct: 'blocked' } })
        .mockResolvedValueOnce({ claims: { acct: 'blocked' } })
        .mockResolvedValueOnce({ claims: { acct: 'blocked' } })
        .mockResolvedValue({ claims: { acct: 'approved' } });
      renderProvider();
      await signInAs();
      await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('blocked'));
      getIdToken.mockClear();
      getIdTokenResult.mockClear();

      await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
      await vi.advanceTimersByTimeAsync(3000);
      await waitFor(() => expect(mocks.callBootstrapUser).toHaveBeenCalledTimes(2));
      expect(getIdTokenResult).toHaveBeenCalledTimes(4);
      expect(getIdToken).toHaveBeenCalledTimes(4); // the first refresh plus 3 retries
    });

    it('gives up after 5 retries and still re-runs the bootstrap', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mocks.callBootstrapUser.mockResolvedValueOnce({ accountStatus: 'blocked' });
      getIdToken.mockResolvedValue('token');
      getIdTokenResult.mockResolvedValue({ claims: { acct: 'blocked' } });
      renderProvider();
      await signInAs();
      await waitFor(() => expect(screen.getByTestId('account')).toHaveTextContent('blocked'));
      getIdToken.mockClear();
      getIdTokenResult.mockClear();

      await userEvent.click(screen.getByRole('button', { name: 'refresh' }));
      await vi.advanceTimersByTimeAsync(4900);
      expect(mocks.callBootstrapUser).toHaveBeenCalledTimes(1); // not yet: still waiting
      await vi.advanceTimersByTimeAsync(200);
      await waitFor(() => expect(mocks.callBootstrapUser).toHaveBeenCalledTimes(2));
      expect(getIdTokenResult).toHaveBeenCalledTimes(6); // the check plus 5 retries
    });
  });
});
