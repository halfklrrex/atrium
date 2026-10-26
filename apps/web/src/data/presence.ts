import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/firebase';

export interface BoardPresence {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  lastActiveAt: Timestamp | { toMillis: () => number } | { seconds: number } | null;
}

export interface PresenceUser {
  uid: string;
  displayName?: string | null;
  photoURL?: string | null;
}

export const PRESENCE_ACTIVE_THRESHOLD_MS = 60_000;
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Checks whether a presence document is still active within the specified threshold.
 */
export function isPresenceActive(
  presence: BoardPresence,
  nowMs: number = Date.now(),
  thresholdMs: number = PRESENCE_ACTIVE_THRESHOLD_MS,
): boolean {
  if (!presence.lastActiveAt) return true; // Server timestamp in-flight / optimistic
  let lastActiveMs: number | null = null;
  if (typeof (presence.lastActiveAt as { toMillis?: () => number }).toMillis === 'function') {
    lastActiveMs = (presence.lastActiveAt as { toMillis: () => number }).toMillis();
  } else if (typeof (presence.lastActiveAt as { seconds?: number }).seconds === 'number') {
    lastActiveMs = (presence.lastActiveAt as { seconds: number }).seconds * 1000;
  }
  if (lastActiveMs === null || Number.isNaN(lastActiveMs)) return true;
  return nowMs - lastActiveMs <= thresholdMs;
}

/**
 * Writes or updates the presence record for a user on a specific board with server timestamp.
 */
export async function writeBoardPresence(boardId: string, user: PresenceUser): Promise<void> {
  const ref = doc(db, 'boards', boardId, 'presence', user.uid);
  const now = Date.now();
  const expiresAt = new Date(now + 60 * 60 * 1000);
  await setDoc(ref, {
    uid: user.uid,
    displayName: user.displayName ? user.displayName.slice(0, 100) : null,
    photoURL: user.photoURL ? user.photoURL.slice(0, 2000) : null,
    lastActiveAt: serverTimestamp(),
    expiresAt,
  });
}

/**
 * Removes the presence record for a user when leaving a board.
 */
export async function deleteBoardPresence(boardId: string, uid: string): Promise<void> {
  const ref = doc(db, 'boards', boardId, 'presence', uid);
  await deleteDoc(ref);
}

/**
 * Hook that maintains the current user's presence heartbeat on a board
 * and subscribes in real-time to active viewers on that board.
 */
export function useBoardPresence(
  boardId: string | undefined,
  currentUser: PresenceUser | null,
): { activeViewers: BoardPresence[]; loading: boolean } {
  const [allPresence, setAllPresence] = useState<BoardPresence[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(boardId && currentUser?.uid));
  const [tick, setTick] = useState<number>(() => Date.now());

  // 1. Write presence and heartbeat
  useEffect(() => {
    if (!boardId || !currentUser?.uid) return;

    const sendHeartbeat = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      void writeBoardPresence(boardId, currentUser).catch((err: unknown) => {
        console.warn('Could not send board presence heartbeat', err);
      });
    };

    sendHeartbeat();

    const heartbeatTimer = setInterval(sendHeartbeat, PRESENCE_HEARTBEAT_INTERVAL_MS);

    const handleVisibilityOrOnline = () => {
      sendHeartbeat();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityOrOnline);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleVisibilityOrOnline);
    }

    const handleUnload = () => {
      void deleteBoardPresence(boardId, currentUser.uid);
    };
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(heartbeatTimer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleVisibilityOrOnline);
        window.removeEventListener('beforeunload', handleUnload);
      }
      void deleteBoardPresence(boardId, currentUser.uid).catch((err: unknown) => {
        console.warn('Could not clean up board presence on unmount', err);
      });
    };
  }, [boardId, currentUser]);

  // 2. Real-time listener for presence docs
  useEffect(() => {
    if (!boardId) return;

    try {
      const colRef = collection(db, 'boards', boardId, 'presence');
      const unsubscribe = onSnapshot(
        colRef,
        (snapshot) => {
          const viewers = snapshot.docs.map((docSnap) => docSnap.data() as BoardPresence);
          setAllPresence(viewers);
          setLoading(false);
        },
        (error) => {
          console.warn('Error listening to board presence', error);
          setAllPresence([]);
          setLoading(false);
        },
      );

      return () => unsubscribe();
    } catch {
      return undefined;
    }
  }, [boardId]);

  // 3. Periodic local clock tick to expire stale viewers
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // 4. Filter active viewers within the threshold
  const activeViewers = useMemo(() => {
    if (!boardId) return [];
    return allPresence.filter((p) => isPresenceActive(p, tick));
  }, [boardId, allPresence, tick]);

  return { activeViewers, loading: boardId ? loading : false };
}

/**
 * Hook that subscribes to active presence viewers on a board.
 */
export function usePresence(
  boardId: string | undefined,
  currentUser: PresenceUser | null = null,
): { viewers: BoardPresence[]; loading: boolean } {
  const { activeViewers, loading } = useBoardPresence(boardId, currentUser);
  return { viewers: activeViewers, loading };
}
