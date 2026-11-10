import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from '../../theme/theme';
import { SettingsIndexRoute } from './SettingsIndex';

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({
    signOut: mocks.signOut,
    user: { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com', photoURL: null },
  }),
}));

function stubPhone(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderIndex() {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsIndexRoute />} />
        <Route path="/settings/profile" element={<p>profile page</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

describe('SettingsIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemeStore.setState({ preference: 'dark' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('on a phone shows the identity card, the two groups and Sign out', async () => {
    stubPhone(true);
    renderIndex();
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(screen.getByText('Avery Quinn')).toBeVisible();
    expect(screen.getByText('avery@example.com')).toBeVisible();
    const you = screen.getByRole('list', { name: 'You' });
    const account = screen.getByRole('list', { name: 'Account' });
    const links = (list: HTMLElement) =>
      within(list)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links(you)).toEqual([
      ['Profile', '/settings/profile'],
      ['AppearanceDark', '/settings/appearance'],
      ['Notifications', '/settings/notifications'],
    ]);
    expect(links(account)).toEqual([
      ['Account', '/settings/account'],
      ['Privacy and data', '/settings/privacy'],
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('the Appearance row shows the current theme', () => {
    stubPhone(true);
    useThemeStore.setState({ preference: 'black' });
    renderIndex();
    expect(screen.getByRole('link', { name: /Appearance/ })).toHaveTextContent('Black');
  });

  it('on desktop redirects to Profile', () => {
    stubPhone(false);
    renderIndex();
    expect(screen.getByText('profile page')).toBeVisible();
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/profile');
  });
});
