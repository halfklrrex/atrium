import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileTab } from './ProfileTab';
import { timeZoneChoices } from './time-zones';

const mocks = vi.hoisted(() => ({
  doc: { timezone: 'Europe/Paris' } as Record<string, unknown> | null,
  setMyProfile: vi.fn(),
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
vi.mock('../../lib/callables', () => ({
  profileCalls: { setMyProfile: (...args: unknown[]) => mocks.setMyProfile(...args) },
}));
vi.mock('../../components/toast-store', () => ({ showToast: mocks.showToast }));

describe('ProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.doc = { timezone: 'Europe/Paris' };
    mocks.setTimezone.mockResolvedValue(undefined);
    mocks.setMyProfile.mockResolvedValue({ workspaces: 1 });
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/New_York',
    } as Intl.ResolvedDateTimeFormatOptions);
  });

  it('shows the Google name and email read-only', () => {
    render(<ProfileTab />);
    expect(screen.getByText('Avery Quinn')).toBeVisible();
    expect(screen.getByText('avery@example.com')).toBeVisible();
    expect(screen.getByText('From your Google account')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Your Google account' })).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Your Google account' })).queryByRole('textbox'),
    ).toBeNull();
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

  it('re-sends the profile after a time zone change when local time is shared', async () => {
    const stamp = { toDate: () => new Date(0), toMillis: () => 0 };
    mocks.doc = {
      timezone: 'Europe/Paris',
      profile: {
        title: 'Mom',
        about: null,
        location: 'Lyon',
        birthday: { month: 3, day: 12 },
        showLocalTime: true,
        updatedAt: stamp,
      },
    };
    render(<ProfileTab />);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Your time zone' }),
      'Asia/Tokyo',
    );
    await vi.waitFor(() =>
      expect(mocks.setMyProfile).toHaveBeenCalledWith({
        title: 'Mom',
        about: null,
        location: 'Lyon',
        birthday: { month: 3, day: 12 },
        showLocalTime: true,
      }),
    );
  });

  it('does not re-send the profile after a time zone change when local time is private', async () => {
    mocks.doc = {
      timezone: 'Europe/Paris',
      profile: { title: 'Mom', about: null, location: null, birthday: null, showLocalTime: false },
    };
    render(<ProfileTab />);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Your time zone' }),
      'Asia/Tokyo',
    );
    await vi.waitFor(() => expect(mocks.setTimezone).toHaveBeenCalled());
    expect(mocks.setMyProfile).not.toHaveBeenCalled();
  });

  it('shows the About you card', () => {
    render(<ProfileTab />);
    expect(screen.getByRole('region', { name: 'About you' })).toBeVisible();
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
