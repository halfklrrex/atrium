import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UNREAD_COUNT_CAP,
  formatUnreadCount,
  notificationWrites,
  useNotificationPrefs,
  useNotifications,
  useUnreadNotifications,
} from './notifications';

const mockUpdateDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchCommit = vi.fn();
const mockNotificationsQuery = vi.fn();
const mockUnreadQuery = vi.fn();
let mockQueryData: { id: string }[] = [];
let mockDocData: unknown = null;

vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('firebase/firestore');
  return {
    ...actual,
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
    deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
    writeBatch: () => ({
      update: (...args: unknown[]) => mockBatchUpdate(...args),
      commit: () => mockBatchCommit(),
    }),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  };
});
vi.mock('./firestore', () => ({
  plainRefs: {
    notification: (uid: string, id: string) => ({ path: `users/${uid}/notifications/${id}` }),
    user: (uid: string) => ({ path: `users/${uid}` }),
  },
  refs: { user: (uid: string) => ({ path: `users/${uid}` }) },
  queries: {
    notifications: (uid: string, size: number) => {
      mockNotificationsQuery(uid, size);
      return { kind: 'list', uid, size };
    },
    unreadNotifications: (uid: string, cap: number) => {
      mockUnreadQuery(uid, cap);
      return { kind: 'unread', uid, cap };
    },
  },
}));
vi.mock('./useSnapshot', () => ({
  useQuerySnapshot: (q: unknown) =>
    q
      ? { data: mockQueryData, loading: false, error: null }
      : { data: [], loading: false, error: null },
  useDocSnapshot: (ref: unknown) =>
    ref
      ? { data: mockDocData, loading: false, error: null }
      : { data: null, loading: false, error: null },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryData = [];
  mockDocData = null;
});

describe('formatUnreadCount', () => {
  it('shows the number up to 99 and "99+" above', () => {
    expect(formatUnreadCount(0)).toBe('0');
    expect(formatUnreadCount(3)).toBe('3');
    expect(formatUnreadCount(99)).toBe('99');
    expect(formatUnreadCount(100)).toBe('99+');
  });
});

describe('useNotifications', () => {
  it('asks for one page, then widens the same query on loadMore', () => {
    mockQueryData = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}` }));
    const { result } = renderHook(() => useNotifications('u1'));
    expect(mockNotificationsQuery).toHaveBeenLastCalledWith('u1', 50);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    expect(mockNotificationsQuery).toHaveBeenLastCalledWith('u1', 100);
    // 50 loaded of a 100 page: nothing older is left.
    expect(result.current.hasMore).toBe(false);
  });

  it('has no more when the first page is not full', () => {
    mockQueryData = [{ id: 'n1' }];
    const { result } = renderHook(() => useNotifications('u1'));
    expect(result.current.hasMore).toBe(false);
    expect(result.current.data).toHaveLength(1);
  });

  it('does not query without a user', () => {
    renderHook(() => useNotifications(undefined));
    expect(mockNotificationsQuery).not.toHaveBeenCalled();
  });
});

describe('useUnreadNotifications', () => {
  it('counts the unread docs, capped by the query limit', () => {
    mockQueryData = [{ id: 'a' }, { id: 'b' }];
    const { result } = renderHook(() => useUnreadNotifications('u1'));
    expect(mockUnreadQuery).toHaveBeenCalledWith('u1', UNREAD_COUNT_CAP);
    expect(result.current.count).toBe(2);
    expect(result.current.ids).toEqual(['a', 'b']);
  });
});

describe('useNotificationPrefs', () => {
  it('treats missing preferences as all on', () => {
    const { result } = renderHook(() => useNotificationPrefs('u1'));
    expect(result.current.prefs).toEqual({ assigned: true, reply: true, mention: true });
  });

  it('reads what the user saved', () => {
    mockDocData = { notificationPrefs: { assigned: false, reply: true, mention: false } };
    const { result } = renderHook(() => useNotificationPrefs('u1'));
    expect(result.current.prefs).toEqual({ assigned: false, reply: true, mention: false });
  });
});

describe('notificationWrites', () => {
  it('marks one read with the server time and unread with null', async () => {
    await notificationWrites.markRead('u1', 'n1');
    expect(mockUpdateDoc).toHaveBeenLastCalledWith(
      { path: 'users/u1/notifications/n1' },
      { readAt: 'SERVER_TIMESTAMP' },
    );
    await notificationWrites.markUnread('u1', 'n1');
    expect(mockUpdateDoc).toHaveBeenLastCalledWith(
      { path: 'users/u1/notifications/n1' },
      { readAt: null },
    );
  });

  it('marks all read in batches of 400, once per id', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `n${i}`);
    await notificationWrites.markAllRead('u1', [...ids, 'n0', 'n1']);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(450);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { path: 'users/u1/notifications/n0' },
      { readAt: 'SERVER_TIMESTAMP' },
    );
  });

  it('commits nothing when there is nothing to mark', async () => {
    await notificationWrites.markAllRead('u1', []);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('deletes a notification', async () => {
    await notificationWrites.remove('u1', 'n9');
    expect(mockDeleteDoc).toHaveBeenCalledWith({ path: 'users/u1/notifications/n9' });
  });

  it('saves the three switches on the user document', async () => {
    await notificationWrites.setPrefs('u1', { assigned: true, reply: false, mention: true });
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'users/u1' },
      { notificationPrefs: { assigned: true, reply: false, mention: true } },
    );
  });
});
