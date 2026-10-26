import type { ViewSettings } from '@atrium/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { viewWrites, type BoardDoc, type BoardViewDoc } from '../../data';
import { currentViewState, settingsFromState, useFilterStore } from '../board-filters';
import { useItemViewStore } from '../item-view/item-view-store';
import { showToast } from '../toast-store';
import type { ViewActionCtx } from './view-actions';
import { BoardViewsContext, type BoardViewsValue } from './view-context';
import { viewPermissions } from './view-permissions';
import { boardViewPath, writeLastView } from './view-paths';

export interface BoardViewsProviderProps {
  board: BoardDoc;
  views: readonly BoardViewDoc[];
  /** The view being shown. */
  view: BoardViewDoc;
  canEdit: boolean;
  children: ReactNode;
}

/**
 * Makes `view` the board's active view: loads its saved settings into the per-view filter store,
 * remembers it as the last view, and offers the tab and "Save to this view" actions to the toolbar.
 * `ready` turns true once the store holds this view, so the body can avoid flashing unfiltered rows.
 */
export function BoardViewsProvider({
  board,
  views,
  view,
  canEdit,
  children,
}: BoardViewsProviderProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const navigate = useNavigate();
  const boardId = board.id;

  // Re-sync when the stored settings change (this client's save or somebody else's), not on every snapshot.
  const settings = view.synthetic ? null : view.settings;
  const settingsKey = JSON.stringify(settings);
  useLayoutEffect(() => {
    useFilterStore
      .getState()
      .syncView(boardId, view.id, JSON.parse(settingsKey) as ViewSettings | null);
  }, [boardId, view.id, settingsKey]);

  useEffect(() => {
    writeLastView(boardId, view.id);
    useItemViewStore.getState().setView(boardId, view.id);
  }, [boardId, view.id]);

  const ready = useFilterStore((s) => s.activeView[boardId] === view.id);

  const goTo = useCallback(
    (viewId: string, options?: { replace?: boolean }) =>
      void navigate(boardViewPath(boardId, viewId), { replace: options?.replace ?? false }),
    [navigate, boardId],
  );
  const actions = useMemo<ViewActionCtx>(
    () => ({ boardId, uid, canEdit, views, goTo }),
    [boardId, uid, canEdit, views, goTo],
  );
  const permissions = useMemo(() => viewPermissions(view, uid, canEdit), [view, uid, canEdit]);

  const save = useCallback(async () => {
    const state = currentViewState(boardId);
    try {
      await viewWrites.saveSettings(boardId, uid, view, settingsFromState(state, view.settings));
      useFilterStore.getState().markSaved(boardId);
    } catch (error) {
      console.warn('Could not save the view', error);
      showToast('Could not save the view. Check your connection and try again.', {
        type: 'negative',
      });
    }
  }, [boardId, uid, view]);

  const value = useMemo<BoardViewsValue>(
    () => ({ views, view, actions, permissions, save, ready }),
    [views, view, actions, permissions, save, ready],
  );

  return <BoardViewsContext.Provider value={value}>{children}</BoardViewsContext.Provider>;
}
