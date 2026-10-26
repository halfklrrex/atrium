import { createContext, useContext } from 'react';
import type { BoardViewDoc } from '../../data';
import type { ViewActionCtx } from './view-actions';
import type { ViewPermissions } from './view-permissions';

/** The board's view tabs and the one being shown, provided by the board page. */
export interface BoardViewsValue {
  views: readonly BoardViewDoc[];
  view: BoardViewDoc;
  /** Everything the tab menu and "+ Add view" need to write and navigate. */
  actions: ViewActionCtx;
  /** What the signed-in user may do with the shown view. */
  permissions: ViewPermissions;
  /** Write the on-screen filters, sort, group-by and hidden columns into the shown view. */
  save: () => Promise<void>;
  /** The view's saved settings are loaded into the filter store; the body may render. */
  ready: boolean;
}

export const BoardViewsContext = createContext<BoardViewsValue | null>(null);

/** `null` outside a board page (unit tests of single components). */
export function useBoardViewsContext(): BoardViewsValue | null {
  return useContext(BoardViewsContext);
}
