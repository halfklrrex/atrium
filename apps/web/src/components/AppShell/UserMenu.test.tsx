import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import { chooseMenuItem } from '../../test/menu';
import { UserMenu } from './UserMenu';
import { useUiStore } from './ui-store';

const auth: AuthContextValue = {
  status: 'ready',
  user: { uid: 'u1', displayName: 'Ada Lovelace', email: 'ada@example.test', photoURL: null },
  lastWorkspaceId: null,
  accountStatus: null,
  refreshAccount: vi.fn(),
  error: null,
  redirectError: null,
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
  retryBootstrap: vi.fn(),
  rememberWorkspace: vi.fn(),
} as unknown as AuthContextValue;

const adminFlag = vi.hoisted(() => ({ value: false }));
vi.mock('../../auth/useIsSiteAdmin', () => ({ useIsSiteAdmin: () => adminFlag.value }));

describe('UserMenu', () => {
  beforeEach(() => {
    adminFlag.value = false;
    useUiStore.setState({ dialog: null });
  });

  it.each([
    [false, false],
    [true, true],
  ])('with the admin claim = %s, shows "Site admin": %s', async (isAdmin, shown) => {
    adminFlag.value = isAdmin;
    render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <UserMenu />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await user.click(screen.getByRole('button', { name: /account menu for ada lovelace/i }));
    await screen.findByRole('menuitem', { name: 'Sign out' });
    expect(screen.queryByRole('menuitem', { name: 'Site admin' }) !== null).toBe(shown);
  });

  it('opens the About dialog from the "About Atrium" item', async () => {
    render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <UserMenu />
        </MemoryRouter>
      </AuthContext.Provider>,
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 }); // the menu is mid-transition in jsdom
    await user.click(screen.getByRole('button', { name: /account menu for ada lovelace/i }));
    await chooseMenuItem(user, 'About Atrium');
    await waitFor(() => expect(useUiStore.getState().dialog).toEqual({ type: 'about' }), {
      timeout: 5000,
    });
  });
});
