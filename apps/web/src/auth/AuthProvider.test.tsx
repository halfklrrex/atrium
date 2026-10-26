import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from 'firebase/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './auth-context';

const mocks = vi.hoisted(() => ({
  authListener: null as null | ((user: User | null) => void),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn(),
  callBootstrapUser: vi.fn(),
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
  signOut: vi.fn(),
}));
vi.mock('../lib/firebase', () => ({ auth: {} }));
vi.mock('../lib/callables', () => ({ callBootstrapUser: mocks.callBootstrapUser }));
vi.mock('../data/firestore', () => ({ writes: { updateUserProfile: vi.fn() } }));

function Probe() {
  const { status, redirectError, signInWithGoogle, retryBootstrap } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="redirect-error">{String((redirectError as Error | null)?.message ?? '')}</p>
      <button onClick={() => void signInWithGoogle().catch(() => {})}>sign in</button>
      <button onClick={retryBootstrap}>retry</button>
    </div>
  );
}

const fakeUser = { uid: 'u1' } as User;
const signInAs = () => act(() => mocks.authListener?.(fakeUser));

beforeEach(() => {
  mocks.authListener = null;
  mocks.getRedirectResult.mockResolvedValue(null);
  mocks.callBootstrapUser.mockResolvedValue({ workspaceId: 'w1' });
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

  it('exposes a failed redirect result on load', async () => {
    mocks.getRedirectResult.mockRejectedValue(
      Object.assign(new Error('bad domain'), { code: 'auth/unauthorized-domain' }),
    );
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('redirect-error')).toHaveTextContent('bad domain'),
    );
  });
});
