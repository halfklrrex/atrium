import { NOTIFICATION_LIMITS, type NotificationPrefs } from '@atrium/shared';
import { serverTimestamp, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { useCallback, useMemo, useState } from 'react';
import { db } from '../lib/firebase';
import { plainRefs, queries, refs } from './firestore';
import type { NotificationDoc } from './model';
import { useDocSnapshot, useQuerySnapshot } from './useSnapshot';

/** The bell counts up to this many unread notifications; above it the badge says "99+". */
export const UNREAD_COUNT_CAP = 100;
export const UNREAD_BADGE_MAX = UNREAD_COUNT_CAP - 1;
/** Firestore allows 500 writes per batch; stay well under it. */
const BATCH_SIZE = 400;

/** "3", or "99+" once there are more than 99. */
export function formatUnreadCount(count: number): string {
  return count > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(count);
}

export interface NotificationsState {
  data: NotificationDoc[];
  loading: boolean;
  error: Error | null;
  /** True while the last page came back full, so there may be older notifications. */
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Live list of the user's notifications, newest first. Starts with one page and "Load more" widens
 * the same live query by another page, so every loaded card keeps updating.
 */
export function useNotifications(uid: string | undefined): NotificationsState {
  const [pages, setPages] = useState(1);
  const size = pages * NOTIFICATION_LIMITS.pageSize;
  const q = useMemo(() => (uid ? queries.notifications(uid, size) : null), [uid, size]);
  const { data, loading, error } = useQuerySnapshot(q);
  const loadMore = useCallback(() => setPages((n) => n + 1), []);
  return { data, loading, error, hasMore: data.length >= size, loadMore };
}

export interface UnreadState {
  /** Unread notifications counted, capped at `UNREAD_COUNT_CAP`. */
  count: number;
  ids: string[];
  loading: boolean;
}

/** Live unread count for the bell badge (and the ids "Mark all as read" needs). */
export function useUnreadNotifications(uid: string | undefined): UnreadState {
  const q = useMemo(() => (uid ? queries.unreadNotifications(uid, UNREAD_COUNT_CAP) : null), [uid]);
  const { data, loading } = useQuerySnapshot(q);
  const ids = useMemo(() => data.map((n) => n.id), [data]);
  return { count: data.length, ids, loading };
}

/** Which kinds of notification the user wants; a missing preference means on. */
export function useNotificationPrefs(uid: string | undefined): {
  prefs: NotificationPrefs;
  loading: boolean;
} {
  const ref = useMemo(() => (uid ? refs.user(uid) : null), [uid]);
  const { data, loading } = useDocSnapshot(ref);
  const prefs = useMemo<NotificationPrefs>(
    () => ({
      assigned: data?.notificationPrefs?.assigned ?? true,
      reply: data?.notificationPrefs?.reply ?? true,
      mention: data?.notificationPrefs?.mention ?? true,
    }),
    [data],
  );
  return { prefs, loading };
}

export const notificationWrites = {
  /** Sets `readAt`; the card stays in the list. */
  async markRead(uid: string, id: string): Promise<void> {
    await updateDoc(plainRefs.notification(uid, id), { readAt: serverTimestamp() });
  },

  async markUnread(uid: string, id: string): Promise<void> {
    await updateDoc(plainRefs.notification(uid, id), { readAt: null });
  },

  /** Marks the given notifications read in batches (the rules allow only `readAt` to change). */
  async markAllRead(uid: string, ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      for (const id of unique.slice(i, i + BATCH_SIZE)) {
        batch.update(plainRefs.notification(uid, id), { readAt: serverTimestamp() });
      }
      await batch.commit();
    }
  },

  async remove(uid: string, id: string): Promise<void> {
    await deleteDoc(plainRefs.notification(uid, id));
  },

  /** Saves the three switches on the user's own document. */
  async setPrefs(uid: string, prefs: NotificationPrefs): Promise<void> {
    await updateDoc(plainRefs.user(uid), {
      notificationPrefs: {
        assigned: prefs.assigned,
        reply: prefs.reply,
        mention: prefs.mention,
      },
    });
  },
};
