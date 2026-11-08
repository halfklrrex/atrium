/**
 * Appeals and feedback Inbox (ADMIN-4, docs/specs/ADMIN-4-appeals-inbox.md): the admin-side
 * listeners and the few writes the rules allow from a client. Everything else (replies, close,
 * reopen, delete) goes through the `inboxCalls` callables.
 *
 * Query shapes (each is covered by an index in `firestore.indexes.json`):
 * - list, both filters: `kind ==`, `status ==`, `orderBy lastMessageAt desc` (kind+status+lastMessageAt)
 * - list, status only: `status ==`, `orderBy lastMessageAt desc` (status+lastMessageAt)
 * - list, kind only: `kind ==`, `orderBy lastMessageAt desc` (kind+lastMessageAt)
 * - list, no filter: `orderBy lastMessageAt desc` (automatic single-field index)
 * - unread count: `adminUnread == true`, `limit 100` (automatic single-field index)
 * - messages: `orderBy seq asc` (automatic single-field index)
 * - sender, approved ("My feedback"): `senderUid ==`, `kind == 'feedback'`, `orderBy lastMessageAt desc`
 *   (senderUid+kind+lastMessageAt)
 * - sender, blocked (blocked screen): `senderUid ==`, `kind == 'appeal'`, `orderBy lastMessageAt desc`,
 *   `limit 1` (the same index). The rules refuse a blocked list query without `kind == 'appeal'`.
 */
import {
  INBOX_LIMITS,
  type InboxKind,
  type InboxMessage,
  type InboxNote,
  type InboxStatus,
  type InboxThread,
} from '@atrium/shared';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type FirestoreDataConverter,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../lib/firebase';
import type { WithId } from './model';
import { useDocSnapshot, useQuerySnapshot, type SnapshotState } from './useSnapshot';

export type InboxThreadDoc = WithId<InboxThread>;
export type InboxMessageDoc = WithId<InboxMessage>;
export type InboxNoteDoc = InboxNote;

/** The Inbox badge counts up to this many unread threads; above 99 it says "99+". */
export const INBOX_UNREAD_CAP = 100;

function converter<T extends object>(): FirestoreDataConverter<WithId<T>, DocumentData> {
  return {
    toFirestore: ({ id: _id, ...data }) => data as DocumentData,
    fromFirestore: (snapshot, options) =>
      ({
        ...(snapshot.data({ ...options, serverTimestamps: 'estimate' }) as T),
        id: snapshot.id,
      }) as WithId<T>,
  };
}

const threadConverter = converter<InboxThread>();
const messageConverter = converter<InboxMessage>();

const threadsRef = (): CollectionReference<InboxThreadDoc> =>
  collection(db, 'inbox').withConverter(threadConverter);

export const inboxQueries = {
  /** One page of threads, newest message first. `null` filters mean "all". */
  list: (
    status: InboxStatus | null,
    kind: InboxKind | null,
    after?: QueryDocumentSnapshot<InboxThreadDoc>,
  ): Query<InboxThreadDoc> => {
    const constraints: QueryConstraint[] = [];
    if (kind) constraints.push(where('kind', '==', kind));
    if (status) constraints.push(where('status', '==', status));
    constraints.push(orderBy('lastMessageAt', 'desc'));
    if (after) constraints.push(startAfter(after));
    constraints.push(limit(INBOX_LIMITS.pageSize));
    return query(threadsRef(), ...constraints);
  },
  unread: (cap: number = INBOX_UNREAD_CAP): Query<InboxThreadDoc> =>
    query(threadsRef(), where('adminUnread', '==', true), limit(cap)),
  /** An approved person's own feedback threads, newest message first. */
  mine: (uid: string): Query<InboxThreadDoc> =>
    query(
      threadsRef(),
      where('senderUid', '==', uid),
      where('kind', '==', 'feedback'),
      orderBy('lastMessageAt', 'desc'),
      limit(INBOX_LIMITS.pageSize),
    ),
  /** A blocked person's latest appeal thread. Must filter `kind == 'appeal'` (the rules require it). */
  latestAppeal: (uid: string): Query<InboxThreadDoc> =>
    query(
      threadsRef(),
      where('senderUid', '==', uid),
      where('kind', '==', 'appeal'),
      orderBy('lastMessageAt', 'desc'),
      limit(1),
    ),
  messages: (threadId: string): Query<InboxMessageDoc> =>
    query(
      collection(db, 'inbox', threadId, 'messages').withConverter(messageConverter),
      orderBy('seq', 'asc'),
    ),
};

const threadRef = (threadId: string): DocumentReference<InboxThreadDoc> =>
  doc(db, 'inbox', threadId).withConverter(threadConverter);
const noteRef = (threadId: string): DocumentReference<DocumentData> =>
  doc(db, 'inboxNotes', threadId);

/** Live count of threads waiting on an admin, capped at `INBOX_UNREAD_CAP`. `false` turns it off. */
export function useInboxUnreadCount(enabled: boolean): { count: number; loading: boolean } {
  const q = useMemo(() => (enabled ? inboxQueries.unread() : null), [enabled]);
  const { data, loading } = useQuerySnapshot(q);
  return { count: data.length, loading };
}

/** The signed-in approved person's own feedback threads (live). `null` uid turns it off. */
export function useMyFeedbackThreads(uid: string | null): SnapshotState<InboxThreadDoc[]> {
  const q = useMemo(() => (uid ? inboxQueries.mine(uid) : null), [uid]);
  return useQuerySnapshot(q);
}

/** The blocked person's latest appeal thread (`null` while they have none). */
export function useMyLatestAppeal(uid: string | null): SnapshotState<InboxThreadDoc | null> {
  const q = useMemo(() => (uid ? inboxQueries.latestAppeal(uid) : null), [uid]);
  const { data, loading, error } = useQuerySnapshot(q);
  return { data: data[0] ?? null, loading, error };
}

export function useInboxThread(threadId: string | undefined): SnapshotState<InboxThreadDoc | null> {
  const ref = useMemo(() => (threadId ? threadRef(threadId) : null), [threadId]);
  return useDocSnapshot(ref);
}

export function useInboxMessages(threadId: string | undefined): SnapshotState<InboxMessageDoc[]> {
  const q = useMemo(() => (threadId ? inboxQueries.messages(threadId) : null), [threadId]);
  return useQuerySnapshot(q);
}

/** The internal note of a thread (`null` while there is none). */
export function useInboxNote(threadId: string | undefined): SnapshotState<InboxNoteDoc | null> {
  const ref = useMemo(() => (threadId ? noteRef(threadId) : null), [threadId]);
  return useDocSnapshot(ref as DocumentReference<InboxNoteDoc> | null);
}

export interface InboxListState {
  threads: InboxThreadDoc[];
  loading: boolean;
  loadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
}

interface LivePage {
  key: string;
  threads: InboxThreadDoc[];
  cursor: QueryDocumentSnapshot<InboxThreadDoc> | null;
  error: Error | null;
}
interface MorePages {
  key: string;
  threads: InboxThreadDoc[];
  cursor: QueryDocumentSnapshot<InboxThreadDoc> | null;
  hasMore: boolean;
  loading: boolean;
  error: Error | null;
}

/**
 * The admin list: the first page is a live listener (unread dots and statuses stay current); older
 * pages are fetched once with a cursor ("Load more"). A change of filters starts over.
 */
export function useInboxList(
  status: InboxStatus | null,
  kind: InboxKind | null,
  enabled = true,
): InboxListState {
  const key = `${status ?? 'all'}|${kind ?? 'all'}`;
  const [live, setLive] = useState<LivePage | null>(null);
  const [more, setMore] = useState<MorePages | null>(null);

  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      inboxQueries.list(status, kind),
      (snap) =>
        setLive({
          key,
          threads: snap.docs.map((d) => d.data()),
          cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1]! : null,
          error: null,
        }),
      (error) => {
        console.error('Inbox list listener failed', error);
        setLive({ key, threads: [], cursor: null, error });
      },
    );
  }, [enabled, status, kind, key]);

  const currentLive = live?.key === key ? live : null;
  const currentMore = more?.key === key ? more : null;

  const threads = useMemo(() => {
    const first = currentLive?.threads ?? [];
    const seen = new Set(first.map((t) => t.id));
    return [...first, ...(currentMore?.threads ?? []).filter((t) => !seen.has(t.id))];
  }, [currentLive, currentMore]);

  const hasMore = currentMore
    ? currentMore.hasMore
    : (currentLive?.threads.length ?? 0) >= INBOX_LIMITS.pageSize;
  const tail = currentMore?.cursor ?? currentLive?.cursor ?? null;
  const busy = currentMore?.loading ?? false;

  const loadMore = useCallback(() => {
    if (!tail || busy) return;
    setMore((prev) => ({
      key,
      threads: prev?.key === key ? prev.threads : [],
      cursor: prev?.key === key ? prev.cursor : null,
      hasMore: true,
      loading: true,
      error: null,
    }));
    getDocs(inboxQueries.list(status, kind, tail)).then(
      (snap) =>
        setMore((prev) => ({
          key,
          threads: [...(prev?.key === key ? prev.threads : []), ...snap.docs.map((d) => d.data())],
          cursor: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1]! : tail,
          hasMore: snap.docs.length >= INBOX_LIMITS.pageSize,
          loading: false,
          error: null,
        })),
      (error: Error) => {
        console.error('Inbox "load more" failed', error);
        setMore((prev) => ({
          key,
          threads: prev?.key === key ? prev.threads : [],
          cursor: prev?.key === key ? prev.cursor : null,
          hasMore: true,
          loading: false,
          error,
        }));
      },
    );
  }, [tail, busy, key, status, kind]);

  return {
    threads,
    loading: enabled && currentLive === null,
    loadingMore: busy,
    error: currentLive?.error ?? currentMore?.error ?? null,
    hasMore,
    loadMore,
  };
}

export const inboxWrites = {
  /** Clears the sender's unread dot (the rules allow the sender to set only `senderUnread` to false). */
  async markSenderRead(threadId: string): Promise<void> {
    await updateDoc(doc(db, 'inbox', threadId), { senderUnread: false });
  },

  /** Clears the unread dot (the rules allow an admin to set only `adminUnread` to false). */
  async markThreadRead(threadId: string): Promise<void> {
    await updateDoc(doc(db, 'inbox', threadId), { adminUnread: false });
  },

  /**
   * Saves the internal note. The rules want exactly `text`, `updatedAt` (server time) and
   * `updatedBy` (the admin's own uid).
   */
  async saveNote(threadId: string, uid: string, text: string): Promise<void> {
    await setDoc(noteRef(threadId), { text, updatedAt: serverTimestamp(), updatedBy: uid });
  },
};
