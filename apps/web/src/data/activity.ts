import { ACTIVITY_LIMITS, activityEventSchema, type ActivityEvent } from '@atrium/shared';
import {
  collection,
  limit,
  orderBy,
  query,
  where,
  Timestamp,
  type DocumentData,
  type FirestoreDataConverter,
  type Query,
  type QueryConstraint,
} from 'firebase/firestore';
import { useCallback, useMemo, useState } from 'react';
import { db } from '../lib/firebase';
import { useQuerySnapshot } from './useSnapshot';

/** An activity entry as the UI sees it: the validated document plus its id. */
export type ActivityDoc = ActivityEvent & { id: string };

/** What the live query hands over before validation (legacy and malformed docs are dropped later). */
interface RawActivity {
  id: string;
  data: DocumentData;
}

const rawConverter: FirestoreDataConverter<RawActivity, DocumentData> = {
  toFirestore: () => {
    throw new Error('Activity entries are written by Cloud Functions only.');
  },
  fromFirestore: (snapshot, options) => ({ id: snapshot.id, data: snapshot.data(options) }),
};

/** The most person ids a Firestore `in` filter takes. */
export const MAX_ACTOR_FILTER = 10;

const activityCollection = (boardId: string) =>
  collection(db, 'boards', boardId, 'activity').withConverter(rawConverter);

/**
 * Validates raw entries with the shared schema and drops what cannot be shown: documents that fail
 * the schema (legacy `button_clicked` entries from before the log existed) and entries past their
 * `expiresAt` (the TTL policy deletes them within about a day, so the list hides them sooner).
 */
export function parseActivity(
  raw: readonly { id: string; data: unknown }[],
  now: number = Date.now(),
): ActivityDoc[] {
  const out: ActivityDoc[] = [];
  for (const { id, data } of raw) {
    const parsed = activityEventSchema.safeParse(data);
    if (!parsed.success) continue;
    if (parsed.data.expiresAt.toMillis() <= now) continue;
    out.push({ ...parsed.data, id });
  }
  return out;
}

/** The board panel's filters. Empty or `null` means "no filter on that". */
export interface ActivityFilters {
  /** People to show (at most `MAX_ACTOR_FILTER`; more are ignored). */
  actorIds: readonly string[];
  columnId: string | null;
  /** Only entries created at or after this time. */
  since: Date | null;
}

export const NO_ACTIVITY_FILTERS: ActivityFilters = { actorIds: [], columnId: null, since: null };

export const hasActivityFilters = (f: ActivityFilters): boolean =>
  f.actorIds.length > 0 || f.columnId !== null || f.since !== null;

export type ActivityDatePreset = 'all' | 'today' | '7d' | '30d';

export const DATE_PRESET_LABELS: Record<ActivityDatePreset, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  all: 'All',
};

/** Start of the window for a date preset ("Today" is since local midnight); `null` for "All". */
export function sinceForPreset(preset: ActivityDatePreset, now: Date = new Date()): Date | null {
  if (preset === 'all') return null;
  if (preset === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = preset === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 86_400_000);
}

export interface WhereSpec {
  field: string;
  op: '==' | 'in' | '>=';
  value: unknown;
}

/** The `where` clauses a board query gets from the filters, in a plain shape (testable). */
export function activityWhereSpecs(filters: ActivityFilters): WhereSpec[] {
  const specs: WhereSpec[] = [];
  const actors = filters.actorIds.slice(0, MAX_ACTOR_FILTER);
  if (actors.length === 1) specs.push({ field: 'actorId', op: '==', value: actors[0] });
  else if (actors.length > 1) specs.push({ field: 'actorId', op: 'in', value: actors });
  if (filters.columnId) specs.push({ field: 'columnId', op: '==', value: filters.columnId });
  if (filters.since) specs.push({ field: 'createdAt', op: '>=', value: filters.since });
  return specs;
}

function constraintsOf(specs: readonly WhereSpec[], size: number): QueryConstraint[] {
  return [
    ...specs.map((s) =>
      where(s.field, s.op, s.value instanceof Date ? Timestamp.fromDate(s.value) : s.value),
    ),
    orderBy('createdAt', 'desc'),
    limit(size),
  ];
}

export interface ActivityState {
  data: ActivityDoc[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  /** Re-subscribes after an error. */
  retry: () => void;
}

/**
 * Live, newest first, one page at a time. "Load more" widens the same live query by another page
 * (as the notifications list does), so every loaded entry keeps updating.
 */
function usePagedActivity(
  build: ((size: number) => Query<RawActivity> | null) | null,
  key: string,
) {
  const [pages, setPages] = useState({ key, count: 1 });
  const [attempt, setAttempt] = useState(0);
  // A different board, item or filter starts again from the first page.
  const count = pages.key === key ? pages.count : 1;
  const size = count * ACTIVITY_LIMITS.pageSize;
  // `attempt` only forces a fresh query object, which makes the listener re-subscribe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const q = useMemo(() => (build ? build(size) : null), [key, size, attempt]);
  const { data: raw, loading, error } = useQuerySnapshot(q);
  const data = useMemo(() => parseActivity(raw), [raw]);
  const loadMore = useCallback(() => setPages({ key, count: count + 1 }), [key, count]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, loading, error, hasMore: raw.length >= size, loadMore, retry } as ActivityState;
}

/** One item's history, newest first (the item card's Activity Log tab). */
export function useItemActivity(
  boardId: string | undefined,
  itemId: string | undefined,
): ActivityState {
  const build =
    boardId && itemId
      ? (size: number) =>
          query(
            activityCollection(boardId),
            where('itemId', '==', itemId),
            ...constraintsOf([], size),
          )
      : null;
  return usePagedActivity(build, `item:${boardId}:${itemId}`);
}

/** The whole board's history with the panel's filters. */
export function useBoardActivity(
  boardId: string | undefined,
  filters: ActivityFilters,
): ActivityState {
  const specs = activityWhereSpecs(filters);
  const build = boardId
    ? (size: number) => query(activityCollection(boardId), ...constraintsOf(specs, size))
    : null;
  return usePagedActivity(build, `board:${boardId}:${JSON.stringify(specs)}`);
}
