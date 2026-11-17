import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../auth/auth-context';
import type { MemberDoc, TeamDoc } from '../../data/model';
import { resetMembersStore, useMembersStore } from '../../data/members-store';
import { resetTeamsStore, useTeamsStore } from '../../data/teams';
import { ts } from '../../test/fixtures';
import { ProfileCard } from './ProfileCard';
import { ProfileLink } from './ProfileLink';
import { formatBirthday, formatLocalTime, zoneCity } from './profile-format';

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../data/members-source', () => ({ subscribeToMembers: () => () => undefined }));
vi.mock('../../data/teams-source', () => ({ subscribeToTeams: () => () => undefined }));

const NOW = new Date('2026-11-17T12:05:00Z');

const profile = (over: Record<string, unknown> = {}) => ({
  title: 'Gardener',
  about: 'I grow tomatoes.',
  location: 'Lyon',
  birthday: { month: 3, day: 12 },
  timeZone: 'Europe/Paris',
  updatedAt: ts(),
  ...over,
});

const member = (id: string, name: string, extra: Partial<MemberDoc> = {}): MemberDoc => ({
  id,
  displayName: name,
  photoURL: null,
  email: `${id}@example.com`,
  role: 'member',
  joinedAt: ts(),
  updatedAt: ts(),
  ...extra,
});

const team = (id: string, name: string, memberUids: string[]): TeamDoc => ({
  id,
  name,
  color: '#9d50dd',
  memberUids,
  createdAt: ts(),
  createdBy: 'avery',
  updatedAt: ts(),
  updatedBy: 'avery',
});

function seed(members: MemberDoc[], teams: TeamDoc[] = []) {
  useMembersStore.setState({
    activeWorkspaceId: 'w1',
    byWorkspace: { w1: { loaded: true, error: null, members } },
  });
  useTeamsStore.setState({ byWorkspace: { w1: { loaded: true, error: null, teams } } });
}

const auth = {
  status: 'ready',
  user: { uid: 'me', displayName: 'Me', email: 'me@example.com', photoURL: null },
  lastWorkspaceId: 'w1',
  error: null,
  redirectError: null,
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
  retryBootstrap: vi.fn(),
  rememberWorkspace: vi.fn(),
} as unknown as AuthContextValue;

function renderLink(uid = 'ava') {
  return render(
    <AuthContext.Provider value={auth}>
      <ProfileLink uid={uid} label="Profile of Ava">
        Ava
      </ProfileLink>
    </AuthContext.Provider>,
  );
}

describe('ProfileCard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    resetMembersStore();
    resetTeamsStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows every shared field, the local time, the birthday and the teams', async () => {
    seed(
      [member('ava', 'Ava Stone', { profile: profile() })],
      [team('t1', 'Garden crew', ['ava']), team('t2', 'Parents', ['someone-else'])],
    );
    renderLink();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Profile of Ava' }));
    const card = screen.getByRole('dialog', { name: 'Profile of Ava Stone' });
    expect(card).toHaveTextContent('Ava Stone');
    expect(card).toHaveTextContent('Gardener');
    expect(card).toHaveTextContent('Lyon');
    expect(card).toHaveTextContent('Birthday: March 12');
    expect(card).toHaveTextContent(/Local time .*\(Paris\)/);
    expect(card).toHaveTextContent('I grow tomatoes.');
    expect(card).toHaveTextContent('ava@example.com');
    const teams = screen.getByRole('list', { name: 'Teams' });
    expect(teams).toHaveTextContent('Garden crew');
    expect(teams).not.toHaveTextContent('Parents');
  });

  it('hides fields that are empty and shows no local time when it is not shared', async () => {
    seed([
      member('ava', 'Ava Stone', {
        profile: profile({
          title: null,
          about: null,
          location: null,
          birthday: null,
          timeZone: null,
        }),
      }),
    ]);
    renderLink();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Profile of Ava' }));
    const card = screen.getByRole('dialog', { name: 'Profile of Ava Stone' });
    expect(card).not.toHaveTextContent('Local time');
    expect(card).not.toHaveTextContent('Birthday');
    expect(screen.queryByRole('list', { name: 'Details' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Teams' })).toBeNull();
    expect(card).toHaveTextContent('Ava Stone');
  });

  it('works for a member who never filled in a profile', async () => {
    seed([member('ava', 'Ava Stone')]);
    renderLink();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Profile of Ava' }));
    expect(screen.getByRole('dialog', { name: 'Profile of Ava Stone' })).toHaveTextContent(
      'ava@example.com',
    );
  });

  it('ignores a bad time zone instead of breaking', async () => {
    seed([member('ava', 'Ava Stone', { profile: profile({ timeZone: 'Mars/Olympus' }) })]);
    renderLink();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole('button', { name: 'Profile of Ava' }));
    expect(screen.getByRole('dialog', { name: 'Profile of Ava Stone' })).not.toHaveTextContent(
      'Local time',
    );
  });

  it('moves focus into the card, closes on Escape and returns focus to the trigger', async () => {
    seed([member('ava', 'Ava Stone', { profile: profile() })]);
    renderLink();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const trigger = screen.getByRole('button', { name: 'Profile of Ava' });
    await user.click(trigger);
    const card = screen.getByRole('dialog', { name: 'Profile of Ava Stone' });
    expect(card.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Profile of Ava Stone' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('opens with Enter and closes on a second click of the trigger', async () => {
    seed([member('ava', 'Ava Stone')]);
    renderLink();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    screen.getByRole('button', { name: 'Profile of Ava' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Profile of Ava Stone' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Profile of Ava' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('falls back to the given name for someone who is not a member here', () => {
    seed([]);
    render(
      <AuthContext.Provider value={auth}>
        <ProfileCard
          uid="gone"
          anchor={document.body}
          fallbackName="Old Author"
          onClose={vi.fn()}
        />
      </AuthContext.Provider>,
    );
    expect(screen.getByRole('dialog', { name: 'Profile of Old Author' })).toHaveTextContent(
      'Old Author',
    );
  });

  it('does not make an automation a profile link', () => {
    seed([]);
    render(
      <AuthContext.Provider value={auth}>
        <ProfileLink uid="automation:abc">Automations</ProfileLink>
      </AuthContext.Provider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Automations')).toBeInTheDocument();
  });

  it('copies the email', async () => {
    seed([member('ava', 'Ava Stone')]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    renderLink();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Profile of Ava' }));
    await user.click(screen.getByRole('button', { name: 'Copy email of Ava Stone' }));
    expect(writeText).toHaveBeenCalledWith('ava@example.com');
  });
});

describe('profile-format', () => {
  it('formats a birthday and rejects a bad month', () => {
    expect(formatBirthday({ month: 2, day: 29 })).toBe('February 29');
    expect(formatBirthday({ month: 13, day: 1 })).toBeNull();
  });

  it('names the city of a zone', () => {
    expect(zoneCity('America/New_York')).toBe('New York');
    expect(zoneCity('UTC')).toBe('UTC');
  });

  it('formats the local time and returns null for a missing or bad zone', () => {
    expect(formatLocalTime('Asia/Tokyo', NOW)).toMatch(/9:05.*\(Tokyo\)/);
    expect(formatLocalTime(null, NOW)).toBeNull();
    expect(formatLocalTime('Not/AZone', NOW)).toBeNull();
  });
});
