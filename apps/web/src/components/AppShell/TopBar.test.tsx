import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type * as Notifications from '../../data/notifications';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';

let mockUnread = 0;

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data/notifications', async () => {
  const actual = await vi.importActual<typeof Notifications>('../../data/notifications');
  return {
    ...actual,
    useUnreadNotifications: () => ({ count: mockUnread, ids: [], loading: false }),
  };
});
vi.mock('./useCurrentWorkspace', () => ({ useCurrentWorkspace: () => ({ workspace: null }) }));
vi.mock('./UserMenu', () => ({ UserMenu: () => null }));

const renderBar = () =>
  render(
    <MemoryRouter>
      <TopBar />
    </MemoryRouter>,
  );

describe('TopBar notifications badge', () => {
  beforeEach(() => {
    mockUnread = 0;
  });

  it('is hidden when nothing is unread', () => {
    renderBar();
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('shows the count and puts it in the bell label', () => {
    mockUnread = 3;
    renderBar();
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
  });

  it('shows 99+ above 99', () => {
    mockUnread = 100;
    renderBar();
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('99+');
    expect(screen.getByRole('button', { name: 'Notifications, 99+ unread' })).toBeInTheDocument();
  });
});
