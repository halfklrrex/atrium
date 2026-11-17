import { assigneeTeamIdsOf, assigneeUidsOf, columnsForItem } from '@atrium/shared';
import { onSnapshot } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { activeBoards, mergeBoards } from './boards';
import { MY_WORK_TEAM_QUERY_CAP, queries } from './firestore';
import { useRecents, useWorkspaces } from './hooks';
import type { BoardDoc, ItemDoc, RecentDoc, TeamDoc } from './model';
import { retainTeams, useTeamsStore } from './teams';
import type { SnapshotState } from './useSnapshot';

/** My Work listens to at most this many boards (most recently visited first, then by name). */
export const MY_WORK_BOARD_CAP = 100;

/**
 * Re-checks the server-maintained `assigneeUids` hint against the board's current columns: a
 * deleted People column leaves a stale hint until the item's next write.
 */
export function isAssignedTo(board: BoardDoc, item: ItemDoc, uid: string): boolean {
  const columns = columnsForItem(board, item);
  return assigneeUidsOf(columns, item.values).includes(uid);
}

/** A team the person belongs to, as My Work needs it. */
export interface MyTeam {
  id: string;
  name: string;
}

/**
 * The first of the person's teams the item is assigned to, or `undefined`. Re-checks the
 * server-maintained `assigneeTeamIds` hint against the board's current columns.
 */
export function viaTeamOf(
  board: BoardDoc,
  item: ItemDoc,
  myTeams: readonly MyTeam[],
): MyTeam | undefined {
  if (myTeams.length === 0) return undefined;
  const assigned = new Set(assigneeTeamIdsOf(columnsForItem(board, item), item.values));
  return myTeams.find((team) => assigned.has(team.id));
}

/** The teams of one workspace that `uid` belongs to, sorted by id and cut to the query cap. */
export function myTeamsIn(teams: readonly TeamDoc[], uid: string): MyTeam[] {
  const mine = teams
    .filter((t) => t.memberUids.includes(uid))
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (mine.length > MY_WORK_TEAM_QUERY_CAP) {
    console.warn(
      `My Work lists work for the first ${MY_WORK_TEAM_QUERY_CAP} of your ${mine.length} teams in one workspace.`,
    );
  }
  return mine.slice(0, MY_WORK_TEAM_QUERY_CAP);
}

/** The boards My Work listens to: most recent visit first, then name; capped. */
export function boardsForMyWork(
  boards: readonly BoardDoc[],
  recents: readonly Pick<RecentDoc, 'boardId' | 'visitedAt'>[],
  cap: number = MY_WORK_BOARD_CAP,
): BoardDoc[] {
  const visited = new Map(recents.map((r) => [r.boardId, r.visitedAt.toMillis()]));
  const sorted = [...boards].sort((a, b) => {
    const av = visited.get(a.id) ?? -1;
    const bv = visited.get(b.id) ?? -1;
    if (av !== bv) return bv - av;
    return (
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
    );
  });
  return sorted.slice(0, cap);
}

const NO_BOARDS: BoardDoc[] = [];

interface BoardsState {
  key: string;
  boards: BoardDoc[];
  pending: number;
  failed: number;
  total: number;
}

/**
 * Every active board the user can read, across all their workspaces (live): per workspace, the
 * "main boards" listener and the "boards I have access to" listener, merged by id. A listener that
 * errors is dropped; `error` is set only when every listener failed.
 */
export function useReadableBoards(uid: string | null): SnapshotState<BoardDoc[]> {
  const workspaces = useWorkspaces(uid);
  const key = workspaces.data.map((w) => w.id).join('|');
  const [state, setState] = useState<BoardsState | null>(null);

  useEffect(() => {
    if (!uid || workspaces.loading) return;
    const ids = key ? key.split('|') : [];
    const lists = new Map<string, BoardDoc[]>();
    const failed = new Set<string>();
    const total = ids.length * 2;
    const publish = () =>
      setState({
        key,
        boards: activeBoards(mergeBoards(...lists.values())),
        pending: total - lists.size - failed.size,
        failed: failed.size,
        total,
      });
    publish();
    const unsubscribers = ids.flatMap((workspaceId) => {
      const listen = (slot: string, q: ReturnType<typeof queries.mainBoardsInWorkspace>) =>
        onSnapshot(
          q,
          (snap) => {
            failed.delete(slot);
            lists.set(
              slot,
              snap.docs.map((d) => d.data()),
            );
            publish();
          },
          () => {
            lists.delete(slot);
            failed.add(slot);
            publish();
          },
        );
      return [
        listen(`${workspaceId}:main`, queries.mainBoardsInWorkspace(workspaceId)),
        listen(`${workspaceId}:mine`, queries.myBoardsInWorkspace(workspaceId, uid)),
      ];
    });
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [uid, key, workspaces.loading]);

  if (!uid) return { data: NO_BOARDS, loading: false, error: null };
  if (workspaces.error) return { data: NO_BOARDS, loading: false, error: workspaces.error };
  if (workspaces.loading || state?.key !== key) {
    return { data: NO_BOARDS, loading: true, error: null };
  }
  const allFailed = state.total > 0 && state.failed === state.total;
  return {
    data: state.boards,
    loading: state.pending > 0,
    error: allFailed ? new Error('Could not load your boards') : null,
  };
}

export interface MyWorkItems {
  /**
   * Assigned items with their boards (re-verified against the boards' current columns). `viaTeam`
   * is set when the item reached the person only through a team they belong to.
   */
  entries: { board: BoardDoc; item: ItemDoc; viaTeam?: MyTeam }[];
  loading: boolean;
  /** Set only when nothing could be read at all. */
  error: Error | null;
  /** The number of readable boards when it is above the cap, else 0. */
  truncatedFrom: number;
  /** Listen again after an error. */
  retry: () => void;
}

/**
 * The signed-in user's assigned items: one listener per readable board on
 * `items where assigneeUids array-contains me and state == 'active'`. When the person belongs to
 * teams in the board's workspace, a second listener asks for `assigneeTeamIds array-contains-any
 * <my teams>` (TEAMS PR 3); those items carry `viaTeam` unless they are assigned to the person
 * directly too. The per-board read rule authorises each one, so a board the user lost access to
 * stops answering and is dropped silently. `error` is set only when every listener failed.
 */
export function useMyWorkItems(uid: string | null): MyWorkItems {
  const boards = useReadableBoards(uid);
  const recents = useRecents(uid);
  const [attempt, setAttempt] = useState(0);

  // The cap only matters above 100 boards; below it the visit order is irrelevant, so late
  // recents must not rebuild the listeners.
  const overCap = boards.data.length > MY_WORK_BOARD_CAP;
  const chosen = useMemo(
    () => boardsForMyWork(boards.data, overCap ? recents.data : []),
    [boards.data, recents.data, overCap],
  );
  const waitingForRecents = overCap && recents.loading;
  const idsKey = waitingForRecents ? '' : chosen.map((b) => b.id).join('|');

  // My teams per workspace of the chosen boards (one shared listener per workspace).
  const workspaceKey = [...new Set(chosen.map((b) => b.workspaceId))].sort().join('|');
  useEffect(() => {
    if (!uid || !workspaceKey) return;
    const releases = workspaceKey.split('|').map((id) => retainTeams(id));
    return () => releases.forEach((release) => release());
  }, [uid, workspaceKey]);
  const teamsByWorkspace = useTeamsStore((s) => s.byWorkspace);
  const myTeams = useMemo(() => {
    const out = new Map<string, MyTeam[]>();
    if (!uid || !workspaceKey) return out;
    for (const id of workspaceKey.split('|')) {
      const mine = myTeamsIn(teamsByWorkspace[id]?.teams ?? [], uid);
      if (mine.length > 0) out.set(id, mine);
    }
    return out;
  }, [uid, workspaceKey, teamsByWorkspace]);
  const teamsPending = workspaceKey.split('|').some((id) => id && !teamsByWorkspace[id]?.loaded);

  // The team listeners to run: `boardId:teamId,teamId` per board whose workspace has my teams.
  const teamQueriesKey = chosen
    .filter((b) => idsKey && myTeams.has(b.workspaceId))
    .map((b) => `${b.id}:${(myTeams.get(b.workspaceId) ?? []).map((t) => t.id).join(',')}`)
    .join('|');
  const requestKey = `${attempt}:${idsKey}:${teamQueriesKey}`;

  const [state, setState] = useState<{
    key: string;
    /** `p:<boardId>` (assigned to me) and `t:<boardId>` (assigned to my teams). */
    items: Record<string, ItemDoc[]>;
    failed: string[];
  } | null>(null);

  useEffect(() => {
    if (!uid || !idsKey) return;
    const items: Record<string, ItemDoc[]> = {};
    const failed = new Set<string>();
    const publish = () => setState({ key: requestKey, items: { ...items }, failed: [...failed] });
    const listen = (slot: string, q: ReturnType<typeof queries.assignedItems>) =>
      onSnapshot(
        q,
        (snap) => {
          failed.delete(slot);
          items[slot] = snap.docs.map((d) => d.data());
          publish();
        },
        () => {
          delete items[slot];
          failed.add(slot);
          publish();
        },
      );
    const unsubscribers = [
      ...idsKey
        .split('|')
        .map((boardId) => listen(`p:${boardId}`, queries.assignedItems(boardId, uid))),
      ...(teamQueriesKey ? teamQueriesKey.split('|') : []).map((entry) => {
        const [boardId = '', ids = ''] = entry.split(':');
        return listen(`t:${boardId}`, queries.teamAssignedItems(boardId, ids.split(',')));
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [uid, idsKey, teamQueriesKey, requestKey]);

  const current = state?.key === requestKey ? state : null;
  const entries = useMemo(() => {
    if (!current || !uid) return [];
    return chosen.flatMap((board) => {
      const direct = (current.items[`p:${board.id}`] ?? []).filter((item) =>
        isAssignedTo(board, item, uid),
      );
      const directIds = new Set(direct.map((item) => item.id));
      const teams = myTeams.get(board.workspaceId) ?? [];
      const viaTeams = (current.items[`t:${board.id}`] ?? []).flatMap((item) => {
        if (directIds.has(item.id)) return [];
        const viaTeam = viaTeamOf(board, item, teams);
        return viaTeam ? [{ board, item, viaTeam }] : [];
      });
      return [...direct.map((item) => ({ board, item })), ...viaTeams];
    });
  }, [current, chosen, uid, myTeams]);

  const boardCount = idsKey ? idsKey.split('|').length : 0;
  const listenerCount = boardCount + (teamQueriesKey ? teamQueriesKey.split('|').length : 0);
  const answered = current ? current.failed.length + Object.keys(current.items).length : 0;
  const everyListenerFailed = listenerCount > 0 && current?.failed.length === listenerCount;
  const loading =
    !!uid &&
    (boards.loading ||
      waitingForRecents ||
      (boardCount > 0 && teamsPending) ||
      (listenerCount > 0 && answered < listenerCount));
  return {
    entries,
    loading,
    error: boards.error ?? (everyListenerFailed ? new Error('Could not load your work') : null),
    truncatedFrom: overCap ? boards.data.length : 0,
    retry: () => setAttempt((n) => n + 1),
  };
}
