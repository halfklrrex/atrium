import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountTab } from './AccountTab';

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), admin: false }));

vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({
    signOut: mocks.signOut,
    user: {
      uid: 'u1',
      email: 'avery@example.com',
      providerData: [{ providerId: 'google.com' }],
    },
  }),
}));
vi.mock('../../auth/useIsSiteAdmin', () => ({ useIsSiteAdmin: () => mocks.admin }));

describe('AccountTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin = false;
  });

  it('shows the Google sign-in and the email', () => {
    render(<AccountTab />);
    expect(screen.getByText('Google')).toBeVisible();
    expect(screen.getByText('avery@example.com')).toBeVisible();
    expect(screen.queryByText('You are a site admin.')).toBeNull();
  });

  it('says so for a site admin', () => {
    mocks.admin = true;
    render(<AccountTab />);
    expect(screen.getByText('You are a site admin.')).toBeVisible();
  });

  it('signs out', async () => {
    render(<AccountTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
