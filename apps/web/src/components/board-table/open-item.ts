import { useItemCardStore } from '../item-card/item-card-store';
import {
  FROM_BOARD_STATE,
  boardPath,
  itemViewPath,
  useItemViewStore,
} from '../item-view/item-view-store';

/**
 * Open an item's side panel (the updates bubble). The full item view and the panel never show at
 * the same time, so an open window goes back to its board first.
 */
export function openItem(boardId: string, itemId: string): void {
  const view = useItemViewStore.getState();
  if (view.openBoardId && view.navigate)
    view.navigate(boardPath(view.openBoardId), { replace: true });
  useItemCardStore.getState().open(boardId, itemId);
}

/**
 * The row's "Open item" icon: the full item view (floating window) at `/boards/:boardId/items/:itemId`.
 * Without a router (unit tests) it falls back to the side panel.
 */
export function openItemFull(boardId: string, itemId: string): void {
  const { navigate } = useItemViewStore.getState();
  if (!navigate) {
    useItemCardStore.getState().open(boardId, itemId);
    return;
  }
  useItemCardStore.getState().closeItemCard();
  navigate(itemViewPath(boardId, itemId), { state: FROM_BOARD_STATE });
}
