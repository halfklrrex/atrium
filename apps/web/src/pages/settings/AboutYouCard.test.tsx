import type { UserProfile } from '@atrium/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutYouCard } from './AboutYouCard';

const mocks = vi.hoisted(() => ({ setMyProfile: vi.fn(), showToast: vi.fn() }));

vi.mock('../../lib/callables', () => ({
  profileCalls: { setMyProfile: (...args: unknown[]) => mocks.setMyProfile(...args) },
}));
vi.mock('../../components/toast-store', () => ({ showToast: mocks.showToast }));

const stamp = { toDate: () => new Date(0), toMillis: () => 0 };
const saved: UserProfile = {
  title: 'Mom',
  about: 'Hello there',
  location: 'Lyon',
  birthday: { month: 3, day: 12 },
  showLocalTime: true,
  updatedAt: stamp as never,
};

describe('AboutYouCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setMyProfile.mockResolvedValue({ workspaces: 2 });
  });

  it('starts empty for a person without a profile and keeps Save disabled', () => {
    render(<AboutYouCard saved={undefined} />);
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Birthday month' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the saved values', () => {
    render(<AboutYouCard saved={saved} />);
    expect(screen.getByLabelText('Title')).toHaveValue('Mom');
    expect(screen.getByRole('textbox', { name: 'About' })).toHaveValue('Hello there');
    expect(screen.getByLabelText('Location')).toHaveValue('Lyon');
    expect(screen.getByRole('combobox', { name: 'Birthday month' })).toHaveValue('3');
    expect(screen.getByRole('combobox', { name: 'Birthday day' })).toHaveValue('12');
    expect(
      screen.getByRole('switch', { name: 'Show my local time to people in my workspaces' }),
    ).toBeChecked();
    expect(screen.getByText('11/500')).toBeVisible();
  });

  it('saves the edited profile through the callable', async () => {
    render(<AboutYouCard saved={undefined} />);
    await userEvent.type(screen.getByLabelText('Title'), '  Treasurer ');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Birthday month' }), '2');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Birthday day' }), '29');
    await userEvent.click(
      screen.getByRole('switch', { name: 'Show my local time to people in my workspaces' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mocks.setMyProfile).toHaveBeenCalledWith({
      title: 'Treasurer',
      about: null,
      location: null,
      birthday: { month: 2, day: 29 },
      showLocalTime: true,
    });
    await vi.waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('Profile saved.', { type: 'positive' }),
    );
  });

  it('Clear removes the birthday and the cleared form saves a null birthday', async () => {
    render(<AboutYouCard saved={saved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('combobox', { name: 'Birthday month' })).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mocks.setMyProfile).toHaveBeenCalledWith(expect.objectContaining({ birthday: null }));
  });

  it('refuses a half-filled or impossible birthday and says why', async () => {
    render(<AboutYouCard saved={undefined} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Birthday month' }), '2');
    expect(screen.getByRole('alert')).toHaveTextContent('Pick both a month and a day');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Birthday day' }), '31');
    expect(screen.getByRole('alert')).toHaveTextContent("That day doesn't exist in that month.");
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
    expect(mocks.setMyProfile).not.toHaveBeenCalled();
  });

  it('toasts the callable error', async () => {
    mocks.setMyProfile.mockRejectedValue(new Error('Your account cannot do this.'));
    render(<AboutYouCard saved={undefined} />);
    await userEvent.type(screen.getByLabelText('Location'), 'Lyon');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        "Couldn't save your profile. Your account cannot do this.",
        { type: 'negative' },
      ),
    );
  });
});
