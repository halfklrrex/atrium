import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

vi.mock('./ProfileTab', () => ({ ProfileTab: () => <p>profile body</p> }));
vi.mock('./AppearanceTab', () => ({ AppearanceTab: () => <p>appearance body</p> }));
vi.mock('./NotificationsTab', () => ({ NotificationsTab: () => <p>notifications body</p> }));
vi.mock('./AccountTab', () => ({ AccountTab: () => <p>account body</p> }));
vi.mock('./PrivacyTab', () => ({ PrivacyTab: () => <p>privacy body</p> }));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:tab" element={<SettingsPage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe('SettingsPage', () => {
  it.each([
    ['profile', 'profile body'],
    ['appearance', 'appearance body'],
    ['notifications', 'notifications body'],
    ['account', 'account body'],
    ['privacy', 'privacy body'],
  ])('shows the %s tab at its own URL', (tab, body) => {
    renderAt(`/settings/${tab}`);
    expect(screen.getByText(body)).toBeVisible();
    expect(screen.getByRole('link', { current: 'page' })).toHaveAttribute(
      'href',
      `/settings/${tab}`,
    );
  });

  it('sends an unknown tab to Profile', () => {
    renderAt('/settings/nonsense');
    expect(screen.getByText('profile body')).toBeVisible();
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/profile');
  });

  it('has the five tabs in a labelled navigation', () => {
    renderAt('/settings/profile');
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)).toEqual([
      'Profile',
      'Appearance',
      'Notifications',
      'Account',
      'Privacy and data',
    ]);
  });

  it('groups the links under You and Account', () => {
    renderAt('/settings/profile');
    const you = screen.getByRole('list', { name: 'You' });
    const account = screen.getByRole('list', { name: 'Account' });
    expect(Array.from(you.querySelectorAll('a')).map((a) => a.textContent)).toEqual([
      'Profile',
      'Appearance',
      'Notifications',
    ]);
    expect(Array.from(account.querySelectorAll('a')).map((a) => a.textContent)).toEqual([
      'Account',
      'Privacy and data',
    ]);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  });

  it.each([
    ['profile', 'Profile', 'How you appear to others, and the details Atrium uses for you.'],
    ['appearance', 'Appearance', 'How Atrium looks on your devices.'],
    ['notifications', 'Notifications', 'What notifies you, in the bell and on your devices.'],
    ['account', 'Account', 'How you sign in.'],
    ['privacy', 'Privacy and data', 'Your data, the privacy notice and the source code.'],
  ])('the %s tab starts with its title and hint', (tab, title, hint) => {
    renderAt(`/settings/${tab}`);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const titles = screen
      .getAllByRole('heading', { level: 2, name: title })
      .filter((h) => !nav.contains(h));
    expect(titles).toHaveLength(1);
    expect(screen.getByText(hint)).toBeVisible();
  });

  it('switching tab keeps the URL in sync and sets the document title', async () => {
    renderAt('/settings/profile');
    expect(document.title).toBe('Settings · Atrium');
    await userEvent.click(screen.getByRole('link', { name: 'Account' }));
    expect(screen.getByText('account body')).toBeVisible();
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/account');
  });
});
