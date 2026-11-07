import type { AccountStatus } from '@atrium/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from './auth-context';
import { ACCOUNT_DISABLED_MESSAGE } from './auth-errors';
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

  it('shows the blocked screen with a sign out button and does not listen', async () => {
    renderGate('blocked');
    expect(screen.getByRole('heading', { name: 'Your account is blocked' })).toBeInTheDocument();
    expect(screen.getByText(ACCOUNT_DISABLED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('the app shell')).not.toBeInTheDocument();
    expect(mocks.snapshot).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
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

  it('stays on the waiting screen when the document cannot be read', () => {
    renderGate('pending');
    act(() => mocks.snapshotError?.());
    expect(screen.getByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
  });
});
