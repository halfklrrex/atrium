/**
 * Live item data for dashboard widgets (P6), generalised from `useMyWorkItems` /
 * `useReadableBoards` in `my-work.ts`: one board listener and one `activeItems` listener per board
 * id. Every listener is authorised by that board's own read rules, so a viewer of a dashboard who
 * cannot read one of its boards simply gets no data for it. Such boards are reported in
 * `unreadableBoardIds` (the UI says "1 board you can't access is hidden"), never thrown.
 */
import { onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { queries } from './firestore';
import { useBoardsByIds } from './hooks';
import { MY_WORK_BOARD_CAP } from './my-work';
import type { BoardDoc, ItemDoc } from './model';

export interface DashboardBoardData {
  board: BoardDoc;
  items: ItemDoc[];
}

export interface DashboardItems {
  /** Readable, active boards in the requested order, each with its live active items. */
  boards: DashboardBoardData[];
  /** Every item of those boards, with its board. */
  entries: { board: BoardDoc; item: ItemDoc }[];
  /** Boards that are missing, not readable by the user, or whose item listener was refused. */
  unreadableBoardIds: string[];
  /** Boards that are readable but archived or deleted (their data is left out). */
  inactiveBoardIds: string[];
  loading: boolean;
  /** Set only when there were boards to read and none of them could be. */
  error: Error | null;
  /** The requested board count when it is above the cap, else 0. */
  truncatedFrom: number;
  /** Listen again after an error. */
  retry: () => void;
}

/** Pure: which of the requested ids are listened to (deduped, capped, order kept). */
export function boardsToListen(
  boardIds: readonly string[],
  cap: number = MY_WORK_BOARD_CAP,
): { ids: string[]; truncatedFrom: number } {
  const unique = [...new Set(boardIds)];
  return { ids: unique.slice(0, cap), truncatedFrom: unique.length > cap ? unique.length : 0 };
}

export interface DashboardItemsInput {
  ids: readonly string[];
  /** Board documents by id; `null` = missing or unreadable; absent = still loading. */
  boardDocs: Readonly<Record<string, BoardDoc | null>>;
  /** Items by board id; absent = the listener has not answered yet. */
  items: Readonly<Record<string, readonly ItemDoc[]>>;
  /** Board ids whose item listener errored. */
  failedItems: readonly string[];
}

export interface DashboardItemsResult {
  boards: DashboardBoardData[];
  unreadableBoardIds: string[];
  inactiveBoardIds: string[];
  pending: boolean;
}

/** Pure: combines the board and item listener results into what the widgets consume. */
export function combineDashboardItems(input: DashboardItemsInput): DashboardItemsResult {
  const failed = new Set(input.failedItems);
  const boards: DashboardBoardData[] = [];
  const unreadable: string[] = [];
  const inactive: string[] = [];
  let pending = false;
  for (const id of input.ids) {
    if (!(id in input.boardDocs)) {
      pending = true;
      continue;
    }
    const board = input.boardDocs[id];
    if (!board || failed.has(id)) {
      unreadable.push(id);
      continue;
    }
    if (board.state !== 'active') {
      inactive.push(id);
      continue;
    }
    const items = input.items[id];
    if (!items) {
      pending = true;
      continue;
    }
    boards.push({ board, items: [...items] });
  }
  return { boards, unreadableBoardIds: unreadable, inactiveBoardIds: inactive, pending };
}

const NO_IDS: string[] = [];

/**
 * Live items of the given boards. Pass a stable list (or memoise it); the hook keys on its content.
 * Board documents come from `useBoardsByIds` (unreadable = `null`), items from one `activeItems`
 * listener per readable, active board.
 */
export function useDashboardItems(boardIds: readonly string[]): DashboardItems {
  const { ids, truncatedFrom } = useMemo(() => boardsToListen(boardIds), [boardIds]);
  const idsKey = ids.join('|');
  const stableIds = useMemo(() => (idsKey ? idsKey.split('|') : NO_IDS), [idsKey]);
  const boardDocs = useBoardsByIds(stableIds);
  const [attempt, setAttempt] = useState(0);

  // Only boards that resolved to an active document get an item listener.
  const listenKey = stableIds.filter((id) => boardDocs.boards[id]?.state === 'active').join('|');
  const requestKey = `${attempt}:${listenKey}`;

  const [state, setState] = useState<{
    key: string;
    items: Record<string, ItemDoc[]>;
    failed: string[];
  } | null>(null);

  useEffect(() => {
    if (!listenKey) return;
    const items: Record<string, ItemDoc[]> = {};
    const failed = new Set<string>();
    const publish = () => setState({ key: requestKey, items: { ...items }, failed: [...failed] });
    const unsubscribers = listenKey.split('|').map((boardId) =>
      onSnapshot(
        queries.activeItems(boardId),
        (snap) => {
          failed.delete(boardId);
          items[boardId] = snap.docs.map((d) => d.data());
          publish();
        },
        () => {
          delete items[boardId];
          failed.add(boardId);
          publish();
        },
      ),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [listenKey, requestKey]);

  const current = state?.key === requestKey ? state : null;
  const combined = useMemo(
    () =>
      combineDashboardItems({
        ids: stableIds,
        boardDocs: boardDocs.boards,
        items: current?.items ?? {},
        failedItems: current?.failed ?? [],
      }),
    [stableIds, boardDocs.boards, current],
  );
  const entries = useMemo(
    () => combined.boards.flatMap(({ board, items }) => items.map((item) => ({ board, item }))),
    [combined.boards],
  );

  const requested = stableIds.length;
  const allUnreadable =
    requested > 0 && !combined.pending && combined.unreadableBoardIds.length === requested;
  return {
    boards: combined.boards,
    entries,
    unreadableBoardIds: combined.unreadableBoardIds,
    inactiveBoardIds: combined.inactiveBoardIds,
    loading: boardDocs.loading || combined.pending,
    error: allUnreadable ? new Error('None of this dashboard’s boards could be read') : null,
    truncatedFrom,
    retry: () => setAttempt((n) => n + 1),
  };
}
