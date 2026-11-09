import { create } from 'zustand';
import { boardPath as slugBoardPath, type BoardRef } from '../../lib/paths';

/** One group's rows as the table shows them (after search, sort and filter). */
export interface VisibleGroup {
  groupId: string;
  ids: string[];
}

type Navigate = (to: string, options?: { replace?: boolean; state?: unknown }) => void;

interface ItemViewState {
  /** Board whose full item view is open, or null. */
  openBoardId: string | null;
  /** The table publishes what it shows, so the window can step through a group's visible rows. */
  visible: Record<string, VisibleGroup[]>;
  navigate: Navigate | null;
  /** The view each open board is showing, so item links and closing stay on that view. */
  viewByBoard: Record<string, string>;
  /** Names of the boards seen so far, so id-only callers can still build `/boards/<slug>-<id>`. */
  boardNames: Record<string, string>;
  setBoardName: (boardId: string, name: string) => void;
  setOpenBoard: (boardId: string | null) => void;
  setVisible: (boardId: string, groups: VisibleGroup[]) => void;
  setNavigate: (navigate: Navigate | null) => void;
  setView: (boardId: string, viewId: string) => void;
}

export const useItemViewStore = create<ItemViewState>((set) => ({
  openBoardId: null,
  visible: {},
  navigate: null,
  viewByBoard: {},
  boardNames: {},
  setBoardName: (boardId, name) =>
    set((s) =>
      s.boardNames[boardId] === name ? s : { boardNames: { ...s.boardNames, [boardId]: name } },
    ),
  setOpenBoard: (openBoardId) => set({ openBoardId }),
  setVisible: (boardId, groups) => set((s) => ({ visible: { ...s.visible, [boardId]: groups } })),
  setNavigate: (navigate) => set({ navigate }),
  setView: (boardId, viewId) =>
    set((s) => ({ viewByBoard: { ...s.viewByBoard, [boardId]: viewId } })),
}));

/**
 * The board's URL on the view it is showing (`/boards/<slug>-<id>`, bare `/boards/<id>` while the
 * name is unknown). Pass the board when you have it; an id alone uses the last name seen.
 */
export const boardPath = (board: BoardRef | string): string => {
  const state = useItemViewStore.getState();
  const id = typeof board === 'string' ? board : board.id;
  const name = typeof board === 'string' ? state.boardNames[id] : board.name;
  const viewId = state.viewByBoard[id];
  return slugBoardPath({ id, name }, viewId ? `/views/${viewId}` : '');
};

export const itemViewPath = (board: BoardRef | string, itemId: string): string =>
  `${boardPath(board)}/items/${itemId}`;

/** Router state set when the window was opened from the board, so closing can go back. */
export const FROM_BOARD_STATE = { fromBoard: true } as const;

/** Previous and next row ids inside the item's group, as the table shows it. */
export function neighbours(
  groups: readonly VisibleGroup[] | undefined,
  itemId: string,
): { prev: string | null; next: string | null; index: number; total: number } {
  const ids = groups?.find((g) => g.ids.includes(itemId))?.ids ?? [];
  const index = ids.indexOf(itemId);
  if (index === -1) return { prev: null, next: null, index: -1, total: 0 };
  return {
    prev: index > 0 ? (ids[index - 1] ?? null) : null,
    next: index < ids.length - 1 ? (ids[index + 1] ?? null) : null,
    index,
    total: ids.length,
  };
}
