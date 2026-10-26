import { canManageBoard, resolveBoardRole } from '@atrium/shared';
import { Button, Heading, Loader, Text } from '@vibe/core';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { boardActions } from '../components/boards/board-actions';
import { BoardHeader } from '../components/boards/BoardHeader';
import { BoardTable } from '../components/board-table/BoardTable';
import { useBoard, useWorkspace, writes } from '../data';
import { NotFoundPage } from './NotFoundPage';
import styles from './Pages.module.css';

/** `/boards/:boardId` - header, view tab and the board table (toolbar, groups, items). */
export function BoardPage() {
  const { boardId } = useParams();
  const { user, rememberWorkspace } = useAuth();
  const uid = user?.uid ?? null;
  const { data: board, loading } = useBoard(boardId);
  const { data: workspace } = useWorkspace(board?.workspaceId);
  const visibleBoardId = board && board.state === 'active' ? board.id : null;
  const workspaceId = board?.workspaceId ?? null;

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

  return (
    <div className={styles.boardPage}>
      <BoardHeader board={board} />
      <BoardTable board={board} />
    </div>
  );
}
