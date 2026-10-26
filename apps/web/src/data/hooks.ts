import { onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { comparePositions } from '../lib/positions';
import { activeBoards, mergeBoards } from './boards';
import { queries, refs } from './firestore';
import { mergeViews } from './views';
import type {
  BoardDoc,
  BoardViewDoc,
  FavoriteDoc,
  FolderDoc,
  InviteDoc,
  ItemDoc,
  RecentDoc,
  WorkspaceDoc,
} from './model';
import { useDocSnapshot, useQuerySnapshot, type SnapshotState } from './useSnapshot';

/** Workspaces the user belongs to (live), sorted by name. */
export function useWorkspaces(uid: string | null): SnapshotState<WorkspaceDoc[]> {
  const q = useMemo(() => (uid ? queries.workspacesForMember(uid) : null), [uid]);
  const state = useQuerySnapshot(q);
  const sorted = useMemo(
    () =>
      [...state.data].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [state.data],
  );
  return { ...state, data: sorted };
}

export function useWorkspace(workspaceId: string | undefined): SnapshotState<WorkspaceDoc | null> {
  const ref = useMemo(() => (workspaceId ? refs.workspace(workspaceId) : null), [workspaceId]);
  return useDocSnapshot(ref);
}

/** Pending invites of a workspace (live, newest first). Pass `enabled: false` unless owner/admin. */
export function useWorkspaceInvites(
  workspaceId: string | undefined,
  enabled: boolean,
): SnapshotState<InviteDoc[]> {
  const q = useMemo(
    () => (workspaceId && enabled ? queries.pendingInvites(workspaceId) : null),
    [workspaceId, enabled],
  );
  const state = useQuerySnapshot(q);
  const sorted = useMemo(
    () => [...state.data].sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()),
    [state.data],
  );
  return { ...state, data: sorted };
}

/** Folders of a workspace (live), ordered by `position`. */
export function useFolders(workspaceId: string | undefined): SnapshotState<FolderDoc[]> {
  const ref = useMemo(() => (workspaceId ? refs.folders(workspaceId) : null), [workspaceId]);
  const state = useQuerySnapshot(ref);
  const sorted = useMemo(() => [...state.data].sort(comparePositions), [state.data]);
  return { ...state, data: sorted };
}

/**
 * Active boards of a workspace that the user can see: the "main boards" listener and the "boards
 * I have explicit access to" listener, merged by id (see `mergeBoards`).
 */
export function useBoards(
  workspaceId: string | undefined,
  uid: string | null,
): SnapshotState<BoardDoc[]> {
  const mainQuery = useMemo(
    () => (workspaceId && uid ? queries.mainBoardsInWorkspace(workspaceId) : null),
    [workspaceId, uid],
  );
  const mineQuery = useMemo(
    () => (workspaceId && uid ? queries.myBoardsInWorkspace(workspaceId, uid) : null),
    [workspaceId, uid],
  );
  const main = useQuerySnapshot(mainQuery);
  const mine = useQuerySnapshot(mineQuery);
  const data = useMemo(
    () => activeBoards(mergeBoards(main.data, mine.data)),
    [main.data, mine.data],
  );
  return {
    data,
    loading: main.loading || mine.loading,
    error: main.error ?? mine.error,
  };
}

export function useBoard(boardId: string | undefined): SnapshotState<BoardDoc | null> {
  const ref = useMemo(() => (boardId ? refs.board(boardId) : null), [boardId]);
  return useDocSnapshot(ref);
}

/**
 * The board's view tabs (live): shared views plus the user's own personal ones, in tab order, with
 * the "Main table" view always first (synthesised until somebody saves its settings).
 */
export function useBoardViews(
  boardId: string | undefined,
  uid: string | null,
): SnapshotState<BoardViewDoc[]> {
  const sharedQuery = useMemo(
    () => (boardId && uid ? queries.sharedViews(boardId) : null),
    [boardId, uid],
  );
  const personalQuery = useMemo(
    () => (boardId && uid ? queries.personalViews(boardId, uid) : null),
    [boardId, uid],
  );
  const shared = useQuerySnapshot(sharedQuery);
  const personal = useQuerySnapshot(personalQuery);
  const data = useMemo(
    () => mergeViews(shared.data, personal.data, uid ?? ''),
    [shared.data, personal.data, uid],
  );
  return {
    data,
    loading: shared.loading || personal.loading,
    error: shared.error ?? personal.error,
  };
}

/**
 * Active items of a board (live, unordered; sort them yourself). Unlike `useQuerySnapshot`, an item
 * that did not change keeps the very same object from one snapshot to the next, so memoised table
 * rows skip rendering on every unrelated edit - that is what keeps 1,000 items smooth.
 */
export function useItems(boardId: string | undefined): SnapshotState<ItemDoc[]> {
  const q = useMemo(() => (boardId ? queries.activeItems(boardId) : null), [boardId]);
  const [delivered, setDelivered] = useState<{
    source: unknown;
    data: ItemDoc[];
    error: Error | null;
  } | null>(null);

  useEffect(() => {
    if (!q) return;
    const cache = new Map<string, ItemDoc>();
    return onSnapshot(
      q,
      (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type === 'removed') cache.delete(change.doc.id);
          else cache.set(change.doc.id, change.doc.data());
        }
        setDelivered({ source: q, data: [...cache.values()], error: null });
      },
      (error) => setDelivered({ source: q, data: [], error }),
    );
  }, [q]);

  if (!q) return { data: NO_ITEMS, loading: false, error: null };
  if (delivered?.source !== q) return { data: NO_ITEMS, loading: true, error: null };
  return { data: delivered.data, loading: false, error: delivered.error };
}

const NO_ITEMS: ItemDoc[] = [];

export function useDeletedItems(boardId: string | undefined): SnapshotState<ItemDoc[]> {
  const q = useMemo(() => (boardId ? queries.deletedItems(boardId) : null), [boardId]);
  return useQuerySnapshot(q);
}

export function useArchivedItems(boardId: string | undefined): SnapshotState<ItemDoc[]> {
  const q = useMemo(() => (boardId ? queries.archivedItems(boardId) : null), [boardId]);
  return useQuerySnapshot(q);
}

/**
 * All boards of a workspace that the user can see, including archived and deleted ones.
 */
export function useAllWorkspaceBoards(
  workspaceId: string | undefined,
  uid: string | null,
): SnapshotState<BoardDoc[]> {
  const mainQuery = useMemo(
    () => (workspaceId && uid ? queries.mainBoardsInWorkspace(workspaceId) : null),
    [workspaceId, uid],
  );
  const mineQuery = useMemo(
    () => (workspaceId && uid ? queries.myBoardsInWorkspace(workspaceId, uid) : null),
    [workspaceId, uid],
  );
  const main = useQuerySnapshot(mainQuery);
  const mine = useQuerySnapshot(mineQuery);
  const data = useMemo(() => mergeBoards(main.data, mine.data), [main.data, mine.data]);
  return {
    data,
    loading: main.loading || mine.loading,
    error: main.error ?? mine.error,
  };
}

/** The user's starred boards, ordered by `position`. */
export function useFavorites(uid: string | null): SnapshotState<FavoriteDoc[]> {
  const ref = useMemo(() => (uid ? refs.favorites(uid) : null), [uid]);
  const state = useQuerySnapshot(ref);
  const sorted = useMemo(
    () =>
      [...state.data].sort((a, b) =>
        comparePositions({ id: a.id, position: a.position }, { id: b.id, position: b.position }),
      ),
    [state.data],
  );
  return { ...state, data: sorted };
}

/** The user's most recently visited boards, newest first (capped at MAX_RECENTS). */
export function useRecents(uid: string | null): SnapshotState<RecentDoc[]> {
  const q = useMemo(() => (uid ? queries.recents(uid) : null), [uid]);
  return useQuerySnapshot(q);
}

/**
 * Live board documents for a list of ids (favourites and recents span workspaces, so they cannot
 * come from the per-workspace listing). Boards that cannot be read or no longer exist map to
 * `null`; boards that are archived or deleted are returned as-is so callers can filter them.
 */
export function useBoardsByIds(ids: readonly string[]): {
  boards: Readonly<Record<string, BoardDoc | null>>;
  loading: boolean;
} {
  const key = ids.join('|');
  const [state, setState] = useState<{ key: string; boards: Record<string, BoardDoc | null> }>({
    key: '',
    boards: {},
  });

  useEffect(() => {
    const wanted = key ? key.split('|') : [];
    const received: Record<string, BoardDoc | null> = {};
    const publish = () => setState({ key, boards: { ...received } });
    const unsubscribers = wanted.map((id) =>
      onSnapshot(
        refs.board(id),
        (snap) => {
          received[id] = snap.exists() ? snap.data() : null;
          publish();
        },
        () => {
          // Not readable (permission denied): treat like a missing board.
          received[id] = null;
          publish();
        },
      ),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [key]);

  const current = state.key === key ? state.boards : {};
  const loading = ids.some((id) => !(id in current));
  return { boards: current, loading };
}
