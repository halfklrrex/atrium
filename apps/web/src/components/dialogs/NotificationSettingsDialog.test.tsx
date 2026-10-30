import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationSettingsDialog } from './NotificationSettingsDialog';

const mockSetPrefs = vi.fn();

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data/notifications', () => ({
  useNotificationPrefs: () => ({
    prefs: { assigned: true, reply: false, mention: true },
    loading: false,
  }),
  notificationWrites: { setPrefs: (...args: unknown[]) => mockSetPrefs(...args) },
}));

describe('NotificationSettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetPrefs.mockResolvedValue(undefined);
  });

  it('shows one switch per kind with the saved state', () => {
    render(<NotificationSettingsDialog onClose={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Assigned to me' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Replies' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Mentions' })).toBeChecked();
  });

  it('saves a change straight away, keeping the other two', async () => {
    render(<NotificationSettingsDialog onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Replies' }));
    expect(mockSetPrefs).toHaveBeenCalledWith('u1', { assigned: true, reply: true, mention: true });
  });

  it('closes from Done', async () => {
    const onClose = vi.fn();
    render(<NotificationSettingsDialog onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
