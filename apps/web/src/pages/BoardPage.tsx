import { MAIN_VIEW_ID, canEditBoard, canManageBoard, resolveBoardRole } from '@atrium/shared';
import { Button, Heading, Loader, Text } from '@vibe/core';
import { Suspense, lazy, useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { boardActions } from '../components/boards/board-actions';
import { BoardHeader } from '../components/boards/BoardHeader';
import { CalendarView } from '../components/board-calendar/CalendarView';
import { TimelineView } from '../components/board-timeline/TimelineView';
import { KanbanBoard } from '../components/board-kanban/KanbanBoard';
import { BoardTable } from '../components/board-table/BoardTable';
import { BoardViewsProvider } from '../components/board-views/BoardViewsProvider';
import { useBoardViewsContext } from '../components/board-views/view-context';
import { boardViewPath, readLastView } from '../components/board-views/view-paths';
import { useBoard, useBoardViews, useWorkspace, writes, type BoardDoc } from '../data';
import { NotFoundPage } from './NotFoundPage';
import styles from './Pages.module.css';

const ItemView = lazy(() =>
  import('../components/item-view/ItemView').then((m) => ({ default: m.ItemView })),
);

/**
 * `/boards/:boardId[/views/:viewId][/items/:itemId]` - header, view tabs and the shown view (for now
 * the board table: toolbar, groups, items). Without a view in the URL the last view used on this
 * board opens (or Main table).
 */
export function BoardPage() {
  const { boardId, viewId: routeViewId, itemId } = useParams();
  const { user, rememberWorkspace } = useAuth();
  const uid = user?.uid ?? null;
  const { data: board, loading } = useBoard(boardId);
  const { data: workspace } = useWorkspace(board?.workspaceId);
  const visibleBoardId = board && board.state === 'active' ? board.id : null;
  const workspaceId = board?.workspaceId ?? null;
  const { data: views, loading: viewsLoading } = useBoardViews(visibleBoardId ?? undefined, uid);

  // Opening a board records the visit and remembers its workspace as the user's last one.
  useEffect(() => {
    if (!uid || !visibleBoardId || !workspaceId) return;
    writes.touchRecent(uid, { id: visibleBoardId, workspaceId }).catch((error: unknown) => {
      console.warn('Could not record the visit', error);
    });
    rememberWorkspace(workspaceId);
  }, [uid, visibleBoardId, workspaceId, rememberWorkspace]);

  if (loading) {
    return (
      <div className={styles.center} role="status">
        <Loader size="medium" />
      </div>
    );
  }

  // Missing boards and ones the user cannot read look the same on purpose.
  if (!board) return <NotFoundPage />;

  if (board.state !== 'active') {
    const isOwner = canManageBoard(resolveBoardRole(board, uid ?? '', workspace?.roles[uid ?? '']));
    return (
      <div className={styles.center}>
        <Heading type="h2">
          This board was {board.state === 'archived' ? 'archived' : 'deleted'}
        </Heading>
        <Text type="text1" color="secondary">
          {isOwner ? 'You can restore it.' : 'Ask the board owner to restore it.'}
        </Text>
        {isOwner ? (
          <Button onClick={() => void boardActions.restore(board)}>Restore board</Button>
        ) : null}
        <Link to={`/workspaces/${board.workspaceId}`} className={styles.link}>
          Back to workspace
        </Link>
      </div>
    );
  }

  if (viewsLoading) {
    return (
      <div className={styles.center} role="status">
        <Loader size="medium" />
      </div>
    );
  }

  // The view to show: the one in the URL, else (opening the board) the last one used, else Main table.
  const wanted = routeViewId ?? (itemId ? MAIN_VIEW_ID : (readLastView(board.id) ?? MAIN_VIEW_ID));
  // A remembered view that is gone (deleted) is not an error: fall back to Main table.
  const view =
    views.find((v) => v.id === wanted) ??
    (routeViewId ? undefined : views.find((v) => v.id === MAIN_VIEW_ID));
  if (!routeViewId && !itemId && view && view.id !== MAIN_VIEW_ID) {
    return <Navigate to={boardViewPath(board.id, view.id)} replace />;
  }
  // A view that was deleted (or is somebody else's personal one) falls back to Main table.
  if (!view) {
    if (routeViewId && routeViewId !== MAIN_VIEW_ID) {
      return <Navigate to={boardViewPath(board.id, MAIN_VIEW_ID)} replace />;
    }
    return <NotFoundPage />;
  }
  const canEdit = canEditBoard(resolveBoardRole(board, uid ?? '', workspace?.roles[uid ?? '']));

  return (
    <BoardViewsProvider board={board} views={views} view={view} canEdit={canEdit}>
      <div className={styles.boardPage}>
        <BoardHeader board={board} />
        <ViewBody board={board} />
        {itemId ? (
          <Suspense fallback={null}>
            <ItemView board={board} itemId={itemId} />
          </Suspense>
        ) : null}
      </div>
    </BoardViewsProvider>
  );
}

/** The body of the shown view. */
function ViewBody({ board }: { board: BoardDoc }) {
  const ctx = useBoardViewsContext();
  if (!ctx?.ready) return null;
  const type = ctx.view.type;
  switch (type) {
    case 'table':
      return <BoardTable board={board} />;
    case 'kanban':
      return <KanbanBoard board={board} />;
    case 'calendar':
      return <CalendarView board={board} />;
    case 'timeline':
      return <TimelineView board={board} />;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
