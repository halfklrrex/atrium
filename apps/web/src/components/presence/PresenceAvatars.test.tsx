import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatViewingNow } from './formatPresence';
import { PresenceAvatars } from './PresenceAvatars';
import type { BoardPresence } from '../../data/presence';

vi.mock('../../auth/auth-context', () => ({
  useAuth: vi.fn(() => ({
    user: { uid: 'u1', displayName: 'Avery' },
  })),
}));

const mockUseBoardPresence = vi.fn();
vi.mock('../../data/presence', () => ({
  useBoardPresence: (...args: unknown[]) => mockUseBoardPresence(...args),
}));

describe('formatViewingNow helper', () => {
  it('formats empty list gracefully', () => {
    expect(formatViewingNow([])).toBe('No active viewers');
  });

  it('formats a single viewer identifying current user', () => {
    const viewers: BoardPresence[] = [
      { uid: 'u1', displayName: 'Avery', photoURL: null, lastActiveAt: null },
    ];
    expect(formatViewingNow(viewers, 'u1')).toBe('Viewing now: Avery (You)');
  });

  it('formats multiple viewers with current user', () => {
    const viewers: BoardPresence[] = [
      { uid: 'u1', displayName: 'Avery', photoURL: null, lastActiveAt: null },
      { uid: 'u2', displayName: 'Alice', photoURL: null, lastActiveAt: null },
      { uid: 'u3', displayName: null, photoURL: null, lastActiveAt: null },
    ];
    expect(formatViewingNow(viewers, 'u1')).toBe('Viewing now: Avery (You), Alice, Anonymous');
  });
});

describe('PresenceAvatars component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when there are no active viewers', () => {
    mockUseBoardPresence.mockReturnValue({ activeViewers: [], loading: false });
    const { container } = render(<PresenceAvatars boardId="b1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when you are the only active viewer (monday fidelity)', () => {
    mockUseBoardPresence.mockReturnValue({
      activeViewers: [{ uid: 'u1', displayName: 'Avery', photoURL: null, lastActiveAt: null }],
      loading: false,
    });
    const { container } = render(<PresenceAvatars boardId="b1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders active viewer avatars with live indicator and tooltip label', () => {
    mockUseBoardPresence.mockReturnValue({
      activeViewers: [
        { uid: 'u1', displayName: 'Avery', photoURL: null, lastActiveAt: null },
        {
          uid: 'u2',
          displayName: 'Alice',
          photoURL: 'https://example.com/alice.png',
          lastActiveAt: null,
        },
      ],
      loading: false,
    });

    render(<PresenceAvatars boardId="b1" />);

    const container = screen.getByTestId('presence-avatars');
    expect(container).toBeInTheDocument();
    expect(container).toHaveAttribute('aria-label', 'Viewing now: Avery (You), Alice');
  });
});
