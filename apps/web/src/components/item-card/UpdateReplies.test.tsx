import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateReplyDoc } from '../../data/model';
import { UpdateReplies } from './UpdateReplies';

let mockReplies: UpdateReplyDoc[] = [];

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../auth/auth-context', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Ada Lovelace' } }),
}));
vi.mock('../../data/updates', () => ({
  useUpdateReplies: () => ({ data: mockReplies, loading: false, error: null }),
  createReply: vi.fn(),
  deleteReply: vi.fn(),
  toggleLikeReply: vi.fn(),
}));

const stamp = {
  seconds: 1700000000,
  nanoseconds: 0,
  toDate: () => new Date(),
  toMillis: () => 1700000000000,
};
const makeReply = (over: Partial<UpdateReplyDoc>): UpdateReplyDoc =>
  ({
    id: 'r1',
    authorId: 'u2',
    authorName: 'Jordan Lee',
    content: 'reply text',
    likes: [],
    createdAt: stamp,
    ...over,
  }) as UpdateReplyDoc;

describe('UpdateReplies', () => {
  beforeEach(() => {
    mockReplies = [];
  });

  it('shows an automation reply as Automations with the automation avatar and no Delete', () => {
    mockReplies = [
      makeReply({
        authorId: 'automation:abc',
        authorName: undefined,
        authorPhotoUrl: 'https://example.com/x.png',
      }),
    ];
    const { container } = render(<UpdateReplies boardId="b1" itemId="i1" updateId="up" />);
    expect(screen.getByText('Automations')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    const row = container.querySelector('#reply-r1') as HTMLElement;
    expect(within(row).getByTestId('avatar-content').tagName.toLowerCase()).toBe('svg');
    expect(screen.queryByRole('button', { name: 'Delete reply' })).not.toBeInTheDocument();
  });

  it('still offers Delete on the signed-in user own reply', () => {
    mockReplies = [makeReply({ authorId: 'u1', authorName: 'Ada Lovelace' })];
    render(<UpdateReplies boardId="b1" itemId="i1" updateId="up" />);
    expect(screen.getByRole('button', { name: 'Delete reply' })).toBeInTheDocument();
  });
});
