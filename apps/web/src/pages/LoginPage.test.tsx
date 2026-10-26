import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import { LoginPage } from './LoginPage';

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'signedOut',
    user: null,
    lastWorkspaceId: null,
    error: null,
    redirectError: null,
    signInWithGoogle: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    retryBootstrap: vi.fn(),
    rememberWorkspace: vi.fn(),
    ...overrides,
  };
}

function renderLogin(value: AuthContextValue) {
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>home page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const googleButton = () => screen.getByRole('button', { name: /continue with google/i });

describe('LoginPage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('links to the source code from the footnote (AGPL section 13)', () => {
    renderLogin(authValue());
    expect(screen.getByRole('link', { name: 'Source code' })).toHaveAttribute(
      'href',
      'https://github.com/halfklrrex/atrium',
    );
  });

  it('shows the Atrium mark, welcome heading and a Google sign-in button with its logo', () => {
    renderLogin(authValue());
    expect(screen.getByRole('heading', { name: /welcome to atrium/i })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Atrium' })).toBeInTheDocument();
    expect(googleButton()).toBeEnabled();
    expect(screen.getByTestId('google-logo')).toBeInTheDocument();
  });

  it('shows the corrected footnote', () => {
    renderLogin(authValue());
    expect(
      screen.getByText('Atrium only uses your Google account to sign you in.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/limited to invited/i)).not.toBeInTheDocument();
  });

  it('starts Google sign-in when the button is clicked', async () => {
    const value = authValue();
    renderLogin(value);
    await userEvent.click(googleButton());
    expect(value.signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('shows the loading state while sign-in is pending', async () => {
    renderLogin(authValue({ signInWithGoogle: vi.fn(() => new Promise<void>(() => {})) }));
    await userEvent.click(googleButton());
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    expect(screen.getByTestId('google-button-spinner')).toBeInTheDocument();
  });

  it('shows the loading state while the account is being bootstrapped', () => {
    renderLogin(authValue({ status: 'bootstrapping' }));
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
  });

  it('resets the button without an error when the popup is closed or cancelled', async () => {
    const closed = Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' });
    const cancelled = Object.assign(new Error('cancelled'), {
      code: 'auth/cancelled-popup-request',
    });
    for (const error of [closed, cancelled]) {
      const { unmount } = renderLogin(
        authValue({ signInWithGoogle: vi.fn().mockRejectedValue(error) }),
      );
      await userEvent.click(googleButton());
      await waitFor(() => expect(googleButton()).toBeEnabled());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      unmount();
    }
  });

  it.each([
    ['auth/unauthorized-domain', "This address isn't allowed to sign in yet."],
    ['auth/network-request-failed', 'Check your connection and try again.'],
  ])('maps %s to a friendly message', async (code, message) => {
    const error = Object.assign(new Error('boom'), { code });
    renderLogin(authValue({ signInWithGoogle: vi.fn().mockRejectedValue(error) }));
    await userEvent.click(googleButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(googleButton()).toBeEnabled();
  });

  it('shows a generic message and logs the code for unknown errors', async () => {
    const error = Object.assign(new Error('weird'), { code: 'auth/internal-error' });
    renderLogin(authValue({ signInWithGoogle: vi.fn().mockRejectedValue(error) }));
    await userEvent.click(googleButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed. Please try again.');
    expect(screen.queryByText(/weird/)).not.toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith(
      'Google sign-in failed',
      'auth/internal-error',
      error,
    );
    expect(googleButton()).toBeEnabled();
  });

  it('shows the error from a failed redirect sign-in', () => {
    const error = Object.assign(new Error('x'), { code: 'auth/unauthorized-domain' });
    renderLogin(authValue({ redirectError: error }));
    expect(screen.getByRole('alert')).toHaveTextContent("This address isn't allowed");
  });

  it('redirects away once the user is signed in and bootstrapped', () => {
    renderLogin(authValue({ status: 'ready', lastWorkspaceId: 'w1' }));
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('shows the setup-failed message with working retry and sign-out when bootstrap failed', async () => {
    const value = authValue({ status: 'error', error: new Error('functions unavailable') });
    renderLogin(value);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't finish setting up your account. Please try again.",
    );
    expect(screen.queryByText(/functions unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('google-logo')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(value.retryBootstrap).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(value.signOut).toHaveBeenCalledTimes(1);
  });
});
