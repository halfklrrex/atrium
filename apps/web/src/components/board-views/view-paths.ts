import { MAIN_VIEW_ID } from '@atrium/shared';

/** `/boards/:boardId/views/:viewId` - one tab of a board. */
export const boardViewPath = (boardId: string, viewId: string): string =>
  `/boards/${boardId}/views/${viewId}`;

const lastViewKey = (boardId: string): string => `atrium.lastView.${boardId}`;

/** The view this browser last showed on a board, if any. Storage can be blocked, so this never throws. */
export function readLastView(boardId: string): string | null {
  try {
    return window.localStorage.getItem(lastViewKey(boardId));
  } catch {
    return null;
  }
}

export function writeLastView(boardId: string, viewId: string): void {
  try {
    if (viewId === MAIN_VIEW_ID) window.localStorage.removeItem(lastViewKey(boardId));
    else window.localStorage.setItem(lastViewKey(boardId), viewId);
  } catch {
    // Remembering the last view is a nicety.
  }
}
