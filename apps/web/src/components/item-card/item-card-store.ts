import { create } from 'zustand';

interface ItemCardState {
  activeBoardId: string | null;
  activeItemId: string | null;
  /** Ordered list of item IDs in the current board/view for prev/next navigation. */
  itemIds: string[];
  open: (boardId: string, itemId: string, itemIds?: string[]) => void;
  openItemCard: (boardId: string, itemId: string, itemIds?: string[]) => void;
  closeItemCard: () => void;
  setActiveItemId: (itemId: string | null) => void;
  setItemIds: (itemIds: string[]) => void;
}

export const useItemCardStore = create<ItemCardState>((set) => ({
  activeBoardId: null,
  activeItemId: null,
  itemIds: [],
  open: (boardId, itemId, itemIds = []) =>
    set({
      activeBoardId: boardId,
      activeItemId: itemId,
      itemIds: itemIds.length > 0 ? itemIds : [],
    }),
  openItemCard: (boardId, itemId, itemIds = []) =>
    set({
      activeBoardId: boardId,
      activeItemId: itemId,
      itemIds: itemIds.length > 0 ? itemIds : [],
    }),
  closeItemCard: () => set({ activeItemId: null, activeBoardId: null }),
  setActiveItemId: (activeItemId) => set({ activeItemId }),
  setItemIds: (itemIds) => set({ itemIds }),
}));
