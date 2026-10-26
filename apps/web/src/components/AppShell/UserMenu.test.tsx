import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { UserMenu } from './UserMenu';
import { useUiStore } from './ui-store';

const auth: AuthContextValue = {
  status: 'ready',
  user: { uid: 'u1', displayName: 'Ada Lovelace', email: 'ada@example.test', photoURL: null },
  lastWorkspaceId: null,
  error: null,
  redirectError: null,
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
  retryBootstrap: vi.fn(),
  rememberWorkspace: vi.fn(),
} as unknown as AuthContextValue;

describe('UserMenu', () => {
  beforeEach(() => useUiStore.setState({ dialog: null }));

  it('opens the About dialog from the "About Atrium" item', async () => {
    render(
      <AuthContext.Provider value={auth}>
        <UserMenu />
      </AuthContext.Provider>,
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 }); // the menu is mid-transition in jsdom
    await user.click(screen.getByRole('button', { name: /account menu for ada lovelace/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'About Atrium' }));
    await waitFor(() => expect(useUiStore.getState().dialog).toEqual({ type: 'about' }), {
      timeout: 5000,
    });
  });
});
