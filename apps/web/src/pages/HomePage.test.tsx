import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBoard, makeWorkspace, ts } from '../test/fixtures';
import { HomePage } from './HomePage';

const mocks = vi.hoisted(() => ({
  recents: [] as { id: string; boardId: string; workspaceId: string; visitedAt: unknown }[],
  boards: {} as Record<string, unknown>,
}));

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({
    user: { uid: 'u1', displayName: 'Avery Quinn', email: 'avery@example.com', photoURL: null },
  }),
}));
vi.mock('../components/boards/FavoriteStar', () => ({ FavoriteStar: () => null }));
vi.mock('../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useWorkspaces: () => ({
    data: [makeWorkspace({ id: 'w1', name: 'Home base', icon: 'H' })],
    loading: false,
    error: null,
  }),
  useRecents: () => ({ data: mocks.recents, loading: false, error: null }),
  useFavorites: () => ({ data: [], loading: false, error: null }),
  useBoardsByIds: () => ({ boards: mocks.boards, loading: false }),
}));

afterEach(() => {
  vi.useRealTimers();
  mocks.recents = [];
  mocks.boards = {};
});

function renderHome() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe('HomePage', () => {
  it('greets the user by first name for the time of day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 23, 19, 30));
    renderHome();
    expect(screen.getByText('Good evening, Avery!')).toBeInTheDocument();
    expect(screen.getByText(/Quickly access your recent boards/)).toBeInTheDocument();
  });

  it('uses the morning greeting before noon', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 23, 7, 0));
    renderHome();
    expect(screen.getByText('Good morning, Avery!')).toBeInTheDocument();
  });

  it('shows a friendly empty state with a create button when nothing was visited', () => {
    renderHome();
    expect(screen.getByText('No boards visited yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create board' })).toBeEnabled();
  });

  it('lists recently visited boards with their workspace, skipping archived ones', () => {
    mocks.recents = [
      { id: 'b1', boardId: 'b1', workspaceId: 'w1', visitedAt: ts() },
      { id: 'b2', boardId: 'b2', workspaceId: 'w1', visitedAt: ts() },
    ];
    mocks.boards = {
      b1: makeBoard({ id: 'b1', name: 'Roadmap' }),
      b2: makeBoard({ id: 'b2', name: 'Old plan', state: 'archived' }),
    };
    renderHome();
    expect(screen.getByRole('link', { name: 'Roadmap' })).toHaveAttribute('href', '/boards/b1');
    expect(screen.queryByText('Old plan')).not.toBeInTheDocument();
    expect(screen.getAllByText('Home base').length).toBeGreaterThan(0);
  });

  it('lists my workspaces as links', () => {
    renderHome();
    expect(screen.getByRole('link', { name: /Home base/ })).toHaveAttribute(
      'href',
      '/workspaces/w1',
    );
  });
});
