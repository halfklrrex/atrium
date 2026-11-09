import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileTab } from './ProfileTab';
import { timeZoneChoices } from './time-zones';

const mocks = vi.hoisted(() => ({
  doc: { timezone: 'Europe/Paris' } as { timezone: string } | null,
  setTimezone: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({
    user: { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com', photoURL: null },
  }),
}));
vi.mock('../../data/user-settings', () => ({
  useMyUserDoc: () => ({ data: mocks.doc, loading: false }),
  userWrites: { setTimezone: (...args: unknown[]) => mocks.setTimezone(...args) },
}));
vi.mock('../../components/toast-store', () => ({ showToast: mocks.showToast }));

describe('ProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.doc = { timezone: 'Europe/Paris' };
    mocks.setTimezone.mockResolvedValue(undefined);
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/New_York',
    } as Intl.ResolvedDateTimeFormatOptions);
  });

  it('shows the Google name and email read-only', () => {
    render(<ProfileTab />);
    expect(screen.getByText('Avery Quinn')).toBeVisible();
    expect(screen.getByText('avery@example.com')).toBeVisible();
    expect(screen.getByText('From your Google account.')).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('selects the stored time zone and saves a change straight away', async () => {
    render(<ProfileTab />);
    const select = screen.getByRole('combobox', { name: 'Your time zone' });
    expect(select).toHaveValue('Europe/Paris');
    await userEvent.selectOptions(select, 'Asia/Tokyo');
    expect(mocks.setTimezone).toHaveBeenCalledWith('u1', 'Asia/Tokyo');
  });

  it('fills in the device time zone from the link button', async () => {
    render(<ProfileTab />);
    await userEvent.click(screen.getByRole('button', { name: /Use this device's time zone/ }));
    expect(mocks.setTimezone).toHaveBeenCalledWith('u1', 'America/New_York');
  });

  it('keeps a stored zone that is not in the list selected', () => {
    mocks.doc = { timezone: 'Mars/Olympus' };
    render(<ProfileTab />);
    expect(screen.getByRole('combobox', { name: 'Your time zone' })).toHaveValue('Mars/Olympus');
    expect(timeZoneChoices('Mars/Olympus')).toContain('Mars/Olympus');
  });

  it('toasts when the write fails', async () => {
    mocks.setTimezone.mockRejectedValue(new Error('denied'));
    render(<ProfileTab />);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Your time zone' }),
      'Asia/Tokyo',
    );
    await vi.waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith("Couldn't save your time zone.", {
        type: 'negative',
      }),
    );
  });

  it('shows the user ID and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ProfileTab />);
    expect(screen.getByTestId('user-id-value')).toHaveTextContent('u1');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('u1');
    await vi.waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('User ID copied.', { type: 'positive' }),
    );
  });

  it('toasts when the clipboard is unavailable', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ProfileTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await vi.waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        "Couldn't copy. Select the ID and copy it by hand.",
        { type: 'negative' },
      ),
    );
  });
});
