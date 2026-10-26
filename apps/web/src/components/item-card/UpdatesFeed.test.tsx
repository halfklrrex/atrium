import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemUpdateDoc } from '../../data/model';
import { UpdatesFeed } from './UpdatesFeed';

const mockCreateUpdate = vi.fn();
const mockToggleLikeUpdate = vi.fn();

let mockUpdatesData: ItemUpdateDoc[] = [];

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Ada Lovelace' } }),
}));

vi.mock('../../data/updates', () => ({
  useItemUpdates: () => ({
    data: mockUpdatesData,
    loading: false,
    error: null,
  }),
  useUpdateReplies: () => ({
    data: [],
    loading: false,
    error: null,
  }),
  createUpdate: (params: unknown) => mockCreateUpdate(params),
  toggleLikeUpdate: (params: unknown) => mockToggleLikeUpdate(params),
  deleteUpdate: vi.fn(),
}));

describe('UpdatesFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdatesData = [];
  });

  it('renders empty state when there are no updates', () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);

    expect(screen.getByText('No updates yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Share updates, ask questions, or post notes for this item/i),
    ).toBeInTheDocument();
  });

  it('renders composer and allows submitting an update', async () => {
    render(<UpdatesFeed boardId="b1" itemId="i1" />);

    const textarea = screen.getByPlaceholderText('Write an update and mention others with @');
    expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();

    await userEvent.click(textarea);
    const submitBtn = screen.getByRole('button', { name: 'Update' });

    expect(submitBtn).toHaveAttribute('aria-disabled', 'true');

    await userEvent.type(textarea, 'Working on responsive layout');
    expect(submitBtn).toHaveAttribute('aria-disabled', 'false');

    await userEvent.click(submitBtn);
    expect(mockCreateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: 'b1',
        itemId: 'i1',
        authorId: 'u1',
        content: 'Working on responsive layout',
      }),
    );
  });

  it('renders updates with author name, content, and like button', async () => {
    mockUpdatesData = [
      {
        id: 'up1',
        itemId: 'i1',
        authorId: 'u1',
        authorName: 'Ada Lovelace',
        content: 'Deployed initial version to staging',
        likes: ['u2'],
        repliesCount: 2,
        createdAt: {
          seconds: 1700000000,
          nanoseconds: 0,
          toDate: () => new Date(),
          toMillis: () => 1700000000000,
        },
        updatedAt: {
          seconds: 1700000000,
          nanoseconds: 0,
          toDate: () => new Date(),
          toMillis: () => 1700000000000,
        },
      },
    ];

    render(<UpdatesFeed boardId="b1" itemId="i1" />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Deployed initial version to staging')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Like update \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replies \(2\)/i })).toBeInTheDocument();

    const likeBtn = screen.getByRole('button', { name: /Like update \(1\)/i });
    await userEvent.click(likeBtn);

    expect(mockToggleLikeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: 'b1',
        itemId: 'i1',
        updateId: 'up1',
        uid: 'u1',
      }),
    );
  });
});
