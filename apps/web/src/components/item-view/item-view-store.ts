import { create } from 'zustand';

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
  setOpenBoard: (boardId: string | null) => void;
  setVisible: (boardId: string, groups: VisibleGroup[]) => void;
  setNavigate: (navigate: Navigate | null) => void;
}

export const useItemViewStore = create<ItemViewState>((set) => ({
  openBoardId: null,
  visible: {},
  navigate: null,
  setOpenBoard: (openBoardId) => set({ openBoardId }),
  setVisible: (boardId, groups) => set((s) => ({ visible: { ...s.visible, [boardId]: groups } })),
  setNavigate: (navigate) => set({ navigate }),
}));

export const itemViewPath = (boardId: string, itemId: string): string =>
  `/boards/${boardId}/items/${itemId}`;

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
