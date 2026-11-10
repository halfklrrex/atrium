import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccountThemeSync } from '../../theme/account-theme';
import { useThemeStore } from '../../theme/theme';
import { AppearanceTab } from './AppearanceTab';

const mocks = vi.hoisted(() => ({ setTheme: vi.fn(), doc: { theme: 'light' } }));
vi.mock('../../data/user-settings', () => ({
  useMyUserDoc: () => ({ data: mocks.doc, loading: false }),
  userWrites: { setTheme: mocks.setTheme },
}));

function Harness() {
  useAccountThemeSync('u1');
  return <AppearanceTab />;
}

describe('AppearanceTab', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.setTheme.mockReset().mockResolvedValue(undefined);
    mocks.doc = { theme: 'system' };
    useThemeStore.setState({ preference: 'system' });
  });

  it('offers System, Light, Dark and Black as one radio group', () => {
    render(<AppearanceTab />);
    const group = screen.getByRole('group', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      'system',
      'light',
      'dark',
      'black',
    ]);
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
  });

  it('shows the Selected tick on the chosen card only', async () => {
    render(<AppearanceTab />);
    expect(screen.getAllByText('Selected')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'System' }).closest('label')).toHaveTextContent(
      'Selected',
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getAllByText('Selected')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'Dark' }).closest('label')).toHaveTextContent(
      'Selected',
    );
  });

  it('draws one hidden preview per theme, System with a light and a dark half', () => {
    const { container } = render(<AppearanceTab />);
    const labels = Array.from(container.querySelectorAll('label'));
    expect(labels).toHaveLength(4);
    labels.forEach((label) => {
      expect(label.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });
    expect(labels[0]!.querySelector('.light-app-theme')).not.toBeNull();
    expect(labels[0]!.querySelector('.dark-app-theme')).not.toBeNull();
    expect(labels[3]!.querySelector('.black-app-theme')).not.toBeNull();
  });

  it('writes the choice to the theme store', async () => {
    render(<AppearanceTab />);
    await userEvent.click(screen.getByRole('radio', { name: 'Black' }));
    expect(useThemeStore.getState().preference).toBe('black');
    expect(screen.getByRole('radio', { name: 'Black' })).toBeChecked();
  });

  it('is operable with the keyboard', async () => {
    render(<AppearanceTab />);
    screen.getByRole('radio', { name: 'System' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(useThemeStore.getState().preference).toBe('light');
  });

  it('saves the choice to the account as well as the browser', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
    expect(mocks.setTheme).toHaveBeenCalledWith('u1', 'dark');
  });

  it('says the choice follows the account', () => {
    render(<AppearanceTab />);
    expect(screen.getByText(/follows your account on every device/)).toBeInTheDocument();
  });
});
