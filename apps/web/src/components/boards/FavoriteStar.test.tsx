import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FavoriteDoc } from '../../data';
import { makeBoard, ts } from '../../test/fixtures';
import { FavoriteStar } from './FavoriteStar';
import { boardActions } from './board-actions';
import styles from './boards.module.css';

const mocks = vi.hoisted(() => ({
  user: { uid: 'u1' } as { uid: string } | null,
  favorites: [] as FavoriteDoc[],
}));

vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('../../data', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useFavorites: () => ({ data: mocks.favorites, loading: false, error: null }),
}));

vi.mock('./board-actions', () => ({
  boardActions: {
    toggleFavorite: vi.fn(),
  },
}));

describe('FavoriteStar', () => {
  const board = makeBoard({ id: 'b1', name: 'Roadmap' });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { uid: 'u1' };
    mocks.favorites = [];
  });

  it('renders unfavourited state with outline icon and accessible label', () => {
    render(<FavoriteStar board={board} />);

    const button = screen.getByRole('button', { name: 'Add to favorites' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    const svg = button.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.classList.contains(styles.starOn!)).toBe(false);

    // Vibe's outline Favorite icon contains clipRule="evenodd" and cutout path
    const path = svg?.querySelector('path');
    expect(path).toHaveAttribute('clip-rule', 'evenodd');
  });

  it('renders favourited state with filled icon and starOn class / gold color', () => {
    mocks.favorites = [
      {
        id: 'b1',
        boardId: 'b1',
        workspaceId: 'w1',
        addedAt: ts(),
        position: 'a0',
      },
    ];

    render(<FavoriteStar board={board} />);

    const button = screen.getByRole('button', { name: 'Remove from favorites' });
    expect(button).toHaveAttribute('aria-pressed', 'true');

    const svg = button.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.classList.contains(styles.starOn!)).toBe(true);

    // FavoriteFilled icon renders solid filled star path without clipRule/cutout
    const path = svg?.querySelector('path');
    expect(path).not.toHaveAttribute('clip-rule');
    expect(path?.getAttribute('d')).toContain(
      'M11.234 3.016a1.379 1.379 0 0 0-2.47 0l-1.78 3.61-3.99.584',
    );
  });

  it('toggles favorite when clicked', () => {
    render(<FavoriteStar board={board} />);

    const button = screen.getByRole('button', { name: 'Add to favorites' });
    fireEvent.click(button);

    expect(boardActions.toggleFavorite).toHaveBeenCalledTimes(1);
    expect(boardActions.toggleFavorite).toHaveBeenCalledWith('u1', board, []);
  });

  it('does nothing when clicked without an authenticated user', () => {
    mocks.user = null;
    render(<FavoriteStar board={board} />);

    const button = screen.getByRole('button', { name: 'Add to favorites' });
    fireEvent.click(button);

    expect(boardActions.toggleFavorite).not.toHaveBeenCalled();
  });
});
