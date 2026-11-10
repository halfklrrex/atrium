import { itemViewPath } from './item-view-store';
import { showToast } from '../toast-store';
import type { BoardRef } from '../../lib/paths';

/** Copy the link to an item's full view and say so. */
export function copyItemLink(board: BoardRef | string, itemId: string): void {
  const url = `${window.location.origin}${itemViewPath(board, itemId)}`;
  navigator.clipboard.writeText(url).then(
    () => showToast('Link copied.', { type: 'positive' }),
    () => showToast('Could not copy the link.', { type: 'negative' }),
  );
}
