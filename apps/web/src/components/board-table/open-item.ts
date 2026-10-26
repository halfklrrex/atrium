import { useItemCardStore } from '../item-card/item-card-store';

/**
 * Open an item's card.
 */
export function openItem(boardId: string, itemId: string): void {
  useItemCardStore.getState().open(boardId, itemId);
}

/**
 * The row's "Open item" icon. For now it opens the side panel; it is the one seam where the future
 * full item view (its own page, its own spec) plugs in.
 */
export function openItemFull(boardId: string, itemId: string): void {
  openItem(boardId, itemId);
}
