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

/** The documents that have a `presence` subcollection: boards and docs. */
export type PresenceParent = 'boards' | 'docs';

async function writePresence(
  parent: PresenceParent,
  parentId: string,
  user: PresenceUser,
): Promise<void> {
  const ref = doc(db, parent, parentId, 'presence', user.uid);
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
 * Writes or updates the presence record for a user on a specific board with server timestamp.
 */
export function writeBoardPresence(boardId: string, user: PresenceUser): Promise<void> {
  return writePresence('boards', boardId, user);
}

/** Same for a doc (`docs/{id}/presence/{uid}`). */
export function writeDocPresence(docId: string, user: PresenceUser): Promise<void> {
  return writePresence('docs', docId, user);
}

async function deletePresence(parent: PresenceParent, parentId: string, uid: string) {
  await deleteDoc(doc(db, parent, parentId, 'presence', uid));
}

/**
 * Removes the presence record for a user when leaving a board.
 */
export function deleteBoardPresence(boardId: string, uid: string): Promise<void> {
  return deletePresence('boards', boardId, uid);
}

/** Removes the presence record for a user when leaving a doc. */
export function deleteDocPresence(docId: string, uid: string): Promise<void> {
  return deletePresence('docs', docId, uid);
}

/**
 * Hook that maintains the current user's presence heartbeat on a board or doc
 * and subscribes in real-time to the active viewers there.
 */
function useParentPresence(
  parent: PresenceParent,
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
      void writePresence(parent, boardId, currentUser).catch((err: unknown) => {
        console.warn('Could not send presence heartbeat', err);
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
      void deletePresence(parent, boardId, currentUser.uid);
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
      void deletePresence(parent, boardId, currentUser.uid).catch((err: unknown) => {
        console.warn('Could not clean up presence on unmount', err);
      });
    };
  }, [parent, boardId, currentUser]);

  // 2. Real-time listener for presence docs
  useEffect(() => {
    if (!boardId) return;

    try {
      const colRef = collection(db, parent, boardId, 'presence');
      const unsubscribe = onSnapshot(
        colRef,
        (snapshot) => {
          const viewers = snapshot.docs.map((docSnap) => docSnap.data() as BoardPresence);
          setAllPresence(viewers);
          setLoading(false);
        },
        (error) => {
          console.warn('Error listening to presence', error);
          setAllPresence([]);
          setLoading(false);
        },
      );

      return () => unsubscribe();
    } catch (error) {
      console.warn('Error subscribing to presence', error);
      return undefined;
    }
  }, [parent, boardId]);

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

export function useBoardPresence(
  boardId: string | undefined,
  currentUser: PresenceUser | null,
): { activeViewers: BoardPresence[]; loading: boolean } {
  return useParentPresence('boards', boardId, currentUser);
}

/** The same heartbeat and listener for a doc page. */
export function useDocPresence(
  docId: string | undefined,
  currentUser: PresenceUser | null,
): { activeViewers: BoardPresence[]; loading: boolean } {
  return useParentPresence('docs', docId, currentUser);
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
