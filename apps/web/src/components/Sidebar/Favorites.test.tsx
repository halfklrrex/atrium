import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FavoriteDoc } from '../../data';
import { makeBoard, ts } from '../../test/fixtures';
import { chooseMenuItem } from '../../test/menu';
import { boardActions } from '../boards/board-actions';
import { Favorites } from './Favorites';

const mocks = vi.hoisted(() => ({
  favorites: [] as FavoriteDoc[],
  boards: {} as Record<string, unknown>,
}));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useFavorites: () => ({ data: mocks.favorites, loading: false, error: null }),
  useBoardsByIds: () => ({ boards: mocks.boards, loading: false }),
}));
vi.mock('../boards/board-actions', () => ({
  boardActions: { moveFavorite: vi.fn(async () => true) },
}));

const fav = (boardId: string, position: string): FavoriteDoc => ({
  id: boardId,
  boardId,
  workspaceId: 'w1',
  addedAt: ts(),
  position,
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderFavorites() {
  return render(
    <MemoryRouter>
      <Favorites />
      <Where />
    </MemoryRouter>,
  );
}

const labels = () => screen.getAllByRole('link').map((a) => a.textContent);

describe('Favorites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.favorites = [fav('a', 'a0'), fav('h', 'a1'), fav('b', 'a2'), fav('c', 'a3')];
    mocks.boards = {
      a: makeBoard({ id: 'a', name: 'Alpha' }),
      // h is hidden (not returned), x archived
      b: makeBoard({ id: 'b', name: 'Bravo' }),
      c: makeBoard({ id: 'c', name: 'Charlie' }),
    };
  });

  it('renders favourites in position order, skipping hidden ones', () => {
    renderFavorites();
    expect(labels()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('skips archived favourites', () => {
    mocks.boards = { ...mocks.boards, b: makeBoard({ id: 'b', name: 'Bravo', state: 'archived' }) };
    renderFavorites();
    expect(labels()).toEqual(['Alpha', 'Charlie']);
  });

  it('Move down writes a key between the next two neighbours and reorders optimistically', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderFavorites();
    await user.click(screen.getByRole('button', { name: 'Reorder options for Alpha' }));
    await chooseMenuItem(user, /^Move down$/);
    await waitFor(() => expect(boardActions.moveFavorite).toHaveBeenCalledTimes(1));
    const [uid, boardId, key] = vi.mocked(boardActions.moveFavorite).mock.calls[0]!;
    expect([uid, boardId]).toEqual(['u1', 'a']);
    expect(key > 'a2' && key < 'a3').toBe(true);
    await waitFor(() => expect(labels()).toEqual(['Bravo', 'Alpha', 'Charlie']));
  });

  it('Move up on the second row puts it before every favourite', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderFavorites();
    await user.click(screen.getByRole('button', { name: 'Reorder options for Bravo' }));
    await chooseMenuItem(user, /^Move up$/);
    await waitFor(() => expect(boardActions.moveFavorite).toHaveBeenCalledTimes(1));
    const key = vi.mocked(boardActions.moveFavorite).mock.calls[0]![2];
    expect(key < 'a0').toBe(true);
  });

  it('disables Move up on the first row and Move down on the last', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderFavorites();
    await user.click(screen.getByRole('button', { name: 'Reorder options for Alpha' }));
    expect((await screen.findByRole('menuitem', { name: /^Move up$/ })).className).toMatch(
      /disabled/,
    );
    expect(screen.getByRole('menuitem', { name: /^Move down$/ }).className).not.toMatch(/disabled/);
  });

  it('a plain click navigates and writes nothing', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderFavorites();
    await user.click(screen.getByRole('link', { name: 'Bravo' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/boards/b');
    expect(boardActions.moveFavorite).not.toHaveBeenCalled();
  });

  it('lifts a row with Space, announces it by name, and Escape cancels without a write', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderFavorites();
    screen.getByRole('link', { name: 'Alpha' }).focus();
    await user.keyboard(' ');
    await waitFor(() =>
      expect(document.querySelector('[aria-live]')).toHaveTextContent(
        /Favorite Alpha.* position 1 of 3/,
      ),
    );
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(document.querySelector('[aria-live]')).toHaveTextContent('Reordering cancelled'),
    );
    expect(boardActions.moveFavorite).not.toHaveBeenCalled();
  });
});
