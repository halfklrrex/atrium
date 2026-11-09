import type { AccountStatus } from '@atrium/shared';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from './auth-context';
import { BLOCKED_SCREEN_MESSAGE } from './AccountGate';
import { RequireAuth } from './RequireAuth';

const mocks = vi.hoisted(() => ({
  snapshot: null as null | ((snap: { data: () => unknown }) => void),
  snapshotError: null as null | (() => void),
  unsubscribe: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  onSnapshot: (_ref: unknown, next: (snap: { data: () => unknown }) => void, error: () => void) => {
    mocks.snapshot = next;
    mocks.snapshotError = error;
    return mocks.unsubscribe;
  },
}));
vi.mock('./AppealPanel', () => ({
  AppealPanel: ({ uid }: { uid: string }) => <div>appeal panel for {uid}</div>,
}));
vi.mock('../data/firestore', () => ({ plainRefs: { user: (uid: string) => ({ uid }) } }));

const signOut = vi.fn();
const refreshAccount = vi.fn();

function auth(accountStatus: AccountStatus | null): AuthContextValue {
  return {
    status: 'ready',
    user: { uid: 'u1', displayName: 'Riley Chen', email: 'riley@example.com' },
    lastWorkspaceId: null,
    accountStatus,
    refreshAccount,
    error: null,
    redirectError: null,
    signInWithGoogle: vi.fn(),
    signOut,
    retryBootstrap: vi.fn(),
    rememberWorkspace: vi.fn(),
  } as unknown as AuthContextValue;
}

function renderGate(accountStatus: AccountStatus | null) {
  return render(
    <AuthContext.Provider value={auth(accountStatus)}>
      <MemoryRouter>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route index element={<p>the app shell</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  mocks.snapshot = null;
  signOut.mockReset();
  refreshAccount.mockReset().mockResolvedValue(undefined);
  mocks.unsubscribe.mockReset();
});

describe('AccountGate', () => {
  it('shows the waiting screen for a pending account and renders no app', async () => {
    renderGate('pending');
    expect(screen.getByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
    expect(
      screen.getByText("An admin needs to approve your account. You'll get in as soon as they do."),
    ).toBeInTheDocument();
    expect(screen.getByText('Signed in as Riley Chen')).toBeInTheDocument();
    expect(screen.queryByText('the app shell')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('shows the blocked screen with the appeal text, the appeal panel and a sign out button', async () => {
    renderGate('blocked');
    expect(screen.getByRole('heading', { name: 'Your account is blocked' })).toBeInTheDocument();
    expect(BLOCKED_SCREEN_MESSAGE).toBe(
      "An admin has blocked this account, so you can't use Atrium with it. If you think this is a mistake, you can send an appeal below.",
    );
    expect(screen.getByText(BLOCKED_SCREEN_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText('appeal panel for u1')).toBeInTheDocument();
    expect(screen.queryByText('the app shell')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('does not show the appeal panel on the pending screen', () => {
    renderGate('pending');
    expect(screen.queryByText(/appeal panel/)).not.toBeInTheDocument();
  });

  it.each([['approved' as const], [null]])('renders the app for status %s', (status) => {
    renderGate(status);
    expect(screen.getByText('the app shell')).toBeInTheDocument();
    expect(mocks.snapshot).toBeNull();
  });

  it('refreshes the session once when the user document becomes approved', async () => {
    renderGate('pending');
    act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'pending' }) }));
    expect(refreshAccount).not.toHaveBeenCalled();
    act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'approved' }) }));
    act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'approved' }) }));
    await waitFor(() => expect(refreshAccount).toHaveBeenCalledTimes(1));
  });

  it('a blocked screen listens for the unblock and refreshes the session once', async () => {
    renderGate('blocked');
    expect(mocks.snapshot).not.toBeNull();
    act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'blocked' }) }));
    expect(refreshAccount).not.toHaveBeenCalled();
    act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'approved' }) }));
    act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'approved' }) }));
    await waitFor(() => expect(refreshAccount).toHaveBeenCalledTimes(1));
  });

  it('recovers on the next snapshot after a refresh that never saw the approved claim', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    refreshAccount.mockRejectedValueOnce(new Error('The approved claim has not arrived yet.'));
    renderGate('blocked');
    act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'approved' }) }));
    await waitFor(() => expect(refreshAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'approved' }) }));
    await waitFor(() => expect(refreshAccount).toHaveBeenCalledTimes(2));
    warn.mockRestore();
  });

  it('retries on a timer after a missed claim, without a new snapshot, up to the cap', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      refreshAccount.mockRejectedValueOnce(new Error('late')).mockResolvedValue(undefined);
      renderGate('blocked');
      act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'approved' }) }));
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshAccount).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(refreshAccount).toHaveBeenCalledTimes(2); // recovered, no further retry
      await vi.advanceTimersByTimeAsync(60000);
      expect(refreshAccount).toHaveBeenCalledTimes(2);

      cleanup();
      refreshAccount.mockReset().mockRejectedValue(new Error('never'));
      renderGate('blocked');
      act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'approved' }) }));
      await vi.advanceTimersByTimeAsync(120000);
      expect(refreshAccount).toHaveBeenCalledTimes(6); // first try plus 5 retries
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('stops retrying when the screen unmounts', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      refreshAccount.mockRejectedValue(new Error('late'));
      const view = renderGate('blocked');
      act(() => mocks.snapshot?.({ data: () => ({ accountStatus: 'approved' }) }));
      await vi.advanceTimersByTimeAsync(0);
      view.unmount();
      await vi.advanceTimersByTimeAsync(60000);
      expect(refreshAccount).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('a blocked screen stays put when the document cannot be read', () => {
    renderGate('blocked');
    act(() => mocks.snapshotError?.());
    expect(screen.getByRole('heading', { name: 'Your account is blocked' })).toBeInTheDocument();
  });

  it('stays on the waiting screen when the document cannot be read', () => {
    renderGate('pending');
    act(() => mocks.snapshotError?.());
    expect(screen.getByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
  });
});
