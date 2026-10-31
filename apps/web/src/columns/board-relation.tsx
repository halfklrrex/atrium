import type {
  BoardRelationSettings,
  BoardRelationValue,
  ColumnDef,
  LinkedItemRef,
} from '@atrium/shared';
import { Connect } from '@vibe/icons';
import classNames from 'classnames';
import { documentId, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import { queries, refs } from '../data/firestore';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

const VISIBLE_PILLS = 2;
const CHUNK_SIZE = 30;
export const UNAVAILABLE_ITEM_LABEL = 'Unavailable item';

/** What the session cache keeps of a linked item: its name and values (Mirror columns read the values). */
export interface LinkedItemData {
  name: string;
  /** `active` or `archived` (deleted and unreadable items are cached as `null`). */
  state: string;
  values: Record<string, unknown>;
}

/**
 * Session cache per linked board: `boardId -> (itemId -> item | null)`.
 * `null` indicates that the item does not exist, was deleted, or cannot be read by the user.
 */
const sessionCache = new Map<string, Map<string, LinkedItemData | null>>();
/** When each cached item was read (`boardId:itemId -> ms`), so a Mirror cell can refresh stale ones. */
const fetchedAt = new Map<string, number>();

/** The cached linked item: `undefined` while unknown, `null` when unreadable, deleted or missing. */
export function getCachedLinkedItem(
  boardId: string,
  itemId: string,
): LinkedItemData | null | undefined {
  return sessionCache.get(boardId)?.get(itemId);
}

function dataToLinkedItem(data: {
  name?: unknown;
  state?: unknown;
  values?: unknown;
}): LinkedItemData | null {
  if (data.state === 'deleted' || typeof data.name !== 'string') return null;
  const values =
    typeof data.values === 'object' && data.values !== null
      ? (data.values as Record<string, unknown>)
      : {};
  return { name: data.name, state: typeof data.state === 'string' ? data.state : 'active', values };
}

function stamp(boardId: string, itemId: string): void {
  fetchedAt.set(`${boardId}:${itemId}`, Date.now());
}

function isFresh(boardId: string, itemId: string, maxAgeMs: number): boolean {
  if (!sessionCache.get(boardId)?.has(itemId)) return false;
  if (maxAgeMs === Infinity) return true;
  const at = fetchedAt.get(`${boardId}:${itemId}`);
  return at !== undefined && Date.now() - at <= maxAgeMs;
}

/** Re-render subscribers when the cache changes (cells use this to pick up fetched items). */
export function useLinkedItemCacheVersion(): number {
  return useSyncExternalStore(subscribeCache, getCacheVersion, getCacheVersion);
}
const cacheListeners = new Set<() => void>();
let cacheVersion = 0;

function subscribeCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

function getCacheVersion(): number {
  return cacheVersion;
}

function notifyCacheListeners(): void {
  cacheVersion += 1;
  for (const listener of cacheListeners) {
    listener();
  }
}

function getOrCreateBoardCache(boardId: string): Map<string, LinkedItemData | null> {
  let boardCache = sessionCache.get(boardId);
  if (!boardCache) {
    boardCache = new Map();
    sessionCache.set(boardId, boardCache);
  }
  return boardCache;
}

interface PendingBatch {
  ids: Set<string>;
  /** Oldest cached copy this batch may leave in place; older ones are read again. */
  maxAgeMs: number;
  promise: Promise<void>;
  resolve: () => void;
}

const pendingByBoard = new Map<string, PendingBatch>();
const inFlightIdsByBoard = new Map<string, Set<string>>();
const inFlightPromisesByBoard = new Map<string, Set<Promise<void>>>();

/**
 * Prime the board-relation session cache for a board (used by tests and showcase).
 */
export function primeBoardRelationCache(
  boardId: string,
  items:
    | ReadonlyMap<string, string | LinkedItemData | null>
    | Record<string, string | LinkedItemData | null>,
): void {
  const boardCache = getOrCreateBoardCache(boardId);
  const entries = items instanceof Map ? items.entries() : Object.entries(items);
  for (const [itemId, item] of entries) {
    boardCache.set(
      itemId,
      typeof item === 'string' ? { name: item, state: 'active', values: {} } : item,
    );
    stamp(boardId, itemId);
  }
  notifyCacheListeners();
}

/**
 * Reset the board-relation session cache and in-flight state (for unit tests).
 */
export function clearBoardRelationCacheForTests(): void {
  sessionCache.clear();
  fetchedAt.clear();
  boardColumnsCache.clear();
  pendingByBoard.clear();
  inFlightIdsByBoard.clear();
  inFlightPromisesByBoard.clear();
  notifyCacheListeners();
}

async function flushPendingBoard(boardId: string): Promise<void> {
  const pending = pendingByBoard.get(boardId);
  if (!pending) return;
  pendingByBoard.delete(boardId);

  const boardCache = getOrCreateBoardCache(boardId);
  let inFlightIds = inFlightIdsByBoard.get(boardId);
  if (!inFlightIds) {
    inFlightIds = new Set();
    inFlightIdsByBoard.set(boardId, inFlightIds);
  }

  const idsToFetch = [...pending.ids].filter(
    (id) => !isFresh(boardId, id, pending.maxAgeMs) && !inFlightIds.has(id),
  );
  for (const id of idsToFetch) {
    inFlightIds.add(id);
  }

  let promiseSet = inFlightPromisesByBoard.get(boardId);
  if (!promiseSet) {
    promiseSet = new Set();
    inFlightPromisesByBoard.set(boardId, promiseSet);
  }
  promiseSet.add(pending.promise);

  try {
    const chunks: string[][] = [];
    for (let i = 0; i < idsToFetch.length; i += CHUNK_SIZE) {
      chunks.push(idsToFetch.slice(i, i + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const snap = await getDocs(query(refs.items(boardId), where(documentId(), 'in', chunk)));
          const found = new Set<string>();
          for (const docSnap of snap.docs) {
            const item = dataToLinkedItem(docSnap.data() as Record<string, unknown>);
            if (item) {
              boardCache.set(docSnap.id, item);
              stamp(boardId, docSnap.id);
              found.add(docSnap.id);
            }
          }
          for (const id of chunk) {
            if (!found.has(id)) {
              boardCache.set(id, null);
              stamp(boardId, id);
            }
          }
        } catch {
          for (const id of chunk) {
            boardCache.set(id, null);
            stamp(boardId, id);
          }
        }
      }),
    );
  } finally {
    for (const id of idsToFetch) {
      inFlightIds.delete(id);
    }
    promiseSet.delete(pending.promise);
    if (idsToFetch.length > 0) {
      notifyCacheListeners();
    }
    pending.resolve();
  }
}

/**
 * Coalesces and batches linked-item reads (name and values) for `boardId` across cells rendering in
 * the same tick. Issues one `getDocs` per chunk of up to 30 item IDs and caches results for the
 * session. `maxAgeMs` (default: never) makes cached copies older than that be read again; the
 * Mirror cell uses it so a remounted cell picks up edits made on the linked board.
 */
export async function fetchLinkedItemNames(
  boardId: string,
  itemIds: readonly string[],
  maxAgeMs: number = Infinity,
): Promise<void> {
  const inFlightIds = inFlightIdsByBoard.get(boardId);
  const needed = itemIds.filter((id) => !isFresh(boardId, id, maxAgeMs) && !inFlightIds?.has(id));

  const waits: Promise<void>[] = [];
  const existingPromises = inFlightPromisesByBoard.get(boardId);
  if (existingPromises && itemIds.some((id) => inFlightIds?.has(id))) {
    waits.push(...existingPromises);
  }

  if (needed.length > 0) {
    let pending = pendingByBoard.get(boardId);
    if (!pending) {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      pending = { ids: new Set(), maxAgeMs, promise, resolve };
      pendingByBoard.set(boardId, pending);
      queueMicrotask(() => {
        void flushPendingBoard(boardId);
      });
    }
    pending.maxAgeMs = Math.min(pending.maxAgeMs, maxAgeMs);
    for (const id of needed) {
      pending.ids.add(id);
    }
    waits.push(pending.promise);
  }

  if (waits.length > 0) {
    await Promise.all(waits);
  }
}

/**
 * Column definitions of a board, read once per session (`null` when the board is missing or the
 * user cannot read it). Mirror columns need the target column's type and settings to render values.
 */
const boardColumnsCache = new Map<string, Promise<ColumnDef[] | null>>();

export function fetchBoardColumns(boardId: string): Promise<ColumnDef[] | null> {
  let promise = boardColumnsCache.get(boardId);
  if (!promise) {
    promise = getDoc(refs.board(boardId)).then(
      (snap) => (snap.exists() ? (snap.data().columns as ColumnDef[]) : null),
      () => null,
    );
    boardColumnsCache.set(boardId, promise);
  }
  return promise;
}

function BoardRelationCell({ value }: CellProps<BoardRelationValue, BoardRelationSettings>) {
  useSyncExternalStore(subscribeCache, getCacheVersion, getCacheVersion);
  const linkedItems = useMemo(() => value?.linkedItems ?? [], [value]);

  useEffect(() => {
    if (linkedItems.length === 0) return;
    const byBoard = new Map<string, string[]>();
    for (const ref of linkedItems) {
      if (sessionCache.get(ref.boardId)?.has(ref.itemId)) continue;
      let list = byBoard.get(ref.boardId);
      if (!list) {
        list = [];
        byBoard.set(ref.boardId, list);
      }
      list.push(ref.itemId);
    }
    for (const [boardId, itemIds] of byBoard) {
      void fetchLinkedItemNames(boardId, itemIds);
    }
  }, [linkedItems]);

  if (linkedItems.length === 0) return <div className={styles.root} />;

  const names = linkedItems.flatMap((ref) => {
    const boardCache = sessionCache.get(ref.boardId);
    if (!boardCache || !boardCache.has(ref.itemId)) return [];
    return [
      {
        key: `${ref.boardId}:${ref.itemId}`,
        name: boardCache.get(ref.itemId)?.name ?? UNAVAILABLE_ITEM_LABEL,
      },
    ];
  });

  if (names.length === 0) return <div className={styles.root} />;

  const shown = names.slice(0, VISIBLE_PILLS);
  const extra = names.length - shown.length;

  return (
    <div className={styles.root}>
      <span className={styles.pills}>
        {shown.map(({ key, name }) => (
          <span key={key} className={styles.pill}>
            {name}
          </span>
        ))}
        {extra > 0 ? <span className={styles.more}>+{extra}</span> : null}
      </span>
    </div>
  );
}

interface CandidateItem {
  boardId: string;
  itemId: string;
  name: string;
}

function BoardRelationEditor({
  value,
  settings,
  column,
  anchor,
  onChange,
  onClose,
}: EditorProps<BoardRelationValue, BoardRelationSettings>) {
  useSyncExternalStore(subscribeCache, getCacheVersion, getCacheVersion);
  const [searchQuery, setSearchQuery] = useState('');
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const boardIds = useMemo(() => settings.boardIds ?? [], [settings.boardIds]);
  const allowMultiple = settings.allowMultipleItems ?? true;
  const selected = useMemo(() => value?.linkedItems ?? [], [value]);

  useEffect(() => {
    if (boardIds.length === 0) return;
    let cancelled = false;

    async function loadBoardItems() {
      const allItems: CandidateItem[] = [];
      await Promise.all(
        boardIds.map(async (boardId) => {
          const boardCache = getOrCreateBoardCache(boardId);
          try {
            const snap = await getDocs(queries.activeItems(boardId));
            for (const docSnap of snap.docs) {
              const item = dataToLinkedItem(docSnap.data() as Record<string, unknown>);
              if (item) {
                boardCache.set(docSnap.id, item);
                stamp(boardId, docSnap.id);
                allItems.push({ boardId, itemId: docSnap.id, name: item.name });
              }
            }
          } catch {
            // Unreadable board: skip gracefully.
          }
        }),
      );
      notifyCacheListeners();
      if (!cancelled) {
        setCandidates(allItems);
        setLoaded(true);
      }
    }

    void loadBoardItems();
    return () => {
      cancelled = true;
    };
  }, [boardIds]);

  useEffect(() => {
    if (selected.length === 0) return;
    const byBoard = new Map<string, string[]>();
    for (const ref of selected) {
      if (sessionCache.get(ref.boardId)?.has(ref.itemId)) continue;
      let list = byBoard.get(ref.boardId);
      if (!list) {
        list = [];
        byBoard.set(ref.boardId, list);
      }
      list.push(ref.itemId);
    }
    for (const [boardId, itemIds] of byBoard) {
      void fetchLinkedItemNames(boardId, itemIds);
    }
  }, [selected]);

  if (boardIds.length === 0) {
    return (
      <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
        <div className={popups.body}>
          <p className={popups.muted}>Select a board in column settings first</p>
        </div>
      </AnchoredPopup>
    );
  }

  const write = (next: LinkedItemRef[]) => onChange(next.length > 0 ? { linkedItems: next } : null);

  const toggle = (target: LinkedItemRef) => {
    const exists = selected.some(
      (item) => item.boardId === target.boardId && item.itemId === target.itemId,
    );
    if (exists) {
      write(
        selected.filter(
          (item) => !(item.boardId === target.boardId && item.itemId === target.itemId),
        ),
      );
    } else if (!allowMultiple) {
      write([target]);
      onClose();
    } else {
      write([...selected, target]);
    }
  };

  const resolveName = (ref: LinkedItemRef): string => {
    const boardCache = sessionCache.get(ref.boardId);
    if (boardCache?.has(ref.itemId)) {
      return boardCache.get(ref.itemId)?.name ?? UNAVAILABLE_ITEM_LABEL;
    }
    const found = candidates.find((c) => c.boardId === ref.boardId && c.itemId === ref.itemId);
    return found?.name ?? UNAVAILABLE_ITEM_LABEL;
  };

  const needle = searchQuery.trim().toLowerCase();
  const filtered = candidates.filter((item) => item.name.toLowerCase().includes(needle));
  const selectedKeys = new Set(selected.map((i) => `${i.boardId}:${i.itemId}`));

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body}>
        {selected.length > 0 ? (
          <div className={popups.selectedPills}>
            {selected.map((ref) => {
              const name = resolveName(ref);
              return (
                <button
                  key={`${ref.boardId}:${ref.itemId}`}
                  type="button"
                  className={popups.selectedPill}
                  aria-label={`Remove ${name}`}
                  onClick={() =>
                    write(
                      selected.filter(
                        (item) => !(item.boardId === ref.boardId && item.itemId === ref.itemId),
                      ),
                    )
                  }
                >
                  {name} ×
                </button>
              );
            })}
          </div>
        ) : null}
        <input
          className={popups.input}
          value={searchQuery}
          placeholder="Search items…"
          aria-label="Search items"
          autoFocus
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <div
          className={popups.list}
          role="listbox"
          aria-label={column.title}
          aria-multiselectable={allowMultiple}
        >
          {filtered.map((candidate) => {
            const key = `${candidate.boardId}:${candidate.itemId}`;
            const isSelected = selectedKeys.has(key);
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={classNames(popups.listRow, isSelected && popups.listRowOn)}
                onClick={() => toggle({ boardId: candidate.boardId, itemId: candidate.itemId })}
              >
                <span className={styles.pill}>{candidate.name}</span>
              </button>
            );
          })}
          {loaded && filtered.length === 0 ? <p className={popups.muted}>No items found</p> : null}
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const boardRelationUi = defineColumnUi<BoardRelationValue, BoardRelationSettings>({
  type: 'board_relation',
  icon: Connect,
  tone: 'purple',
  editor: 'popover',
  Cell: BoardRelationCell,
  Editor: BoardRelationEditor,
});
