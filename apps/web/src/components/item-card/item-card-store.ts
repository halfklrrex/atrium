import { create } from 'zustand';

/** The side panel's tabs. `'files'` arrives with the Files tab. */
export type ItemPanelTab = 'overview' | 'updates' | 'files' | 'activity';

interface ItemCardState {
  activeBoardId: string | null;
  activeItemId: string | null;
  /** Ordered list of item IDs in the current board/view for prev/next navigation. */
  itemIds: string[];
  /** The tab showing. A fresh open uses the opener's tab; stepping to another item keeps it. */
  tab: ItemPanelTab;
  open: (boardId: string, itemId: string, itemIds?: string[], tab?: ItemPanelTab) => void;
  openItemCard: (boardId: string, itemId: string, itemIds?: string[], tab?: ItemPanelTab) => void;
  closeItemCard: () => void;
  setActiveItemId: (itemId: string | null) => void;
  setItemIds: (itemIds: string[]) => void;
  setTab: (tab: ItemPanelTab) => void;
}

export const useItemCardStore = create<ItemCardState>((set) => {
  const openWith = (
    boardId: string,
    itemId: string,
    itemIds: string[] = [],
    tab: ItemPanelTab = 'overview',
  ) =>
    set({
      activeBoardId: boardId,
      activeItemId: itemId,
      itemIds: itemIds.length > 0 ? itemIds : [],
      tab,
    });
  return {
    activeBoardId: null,
    activeItemId: null,
    itemIds: [],
    tab: 'overview',
    open: openWith,
    openItemCard: openWith,
    closeItemCard: () => set({ activeItemId: null, activeBoardId: null, tab: 'overview' }),
    setActiveItemId: (activeItemId) => set({ activeItemId }),
    setItemIds: (itemIds) => set({ itemIds }),
    setTab: (tab) => set({ tab }),
  };
});
