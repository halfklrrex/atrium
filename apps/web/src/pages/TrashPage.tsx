import { canManageWorkspace } from '@atrium/shared';
import { Button, Heading, Loader, Tab, TabList, Text } from '@vibe/core';
import { Archive, Board, Delete, NavigationChevronLeft, Retry } from '@vibe/icons';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { showToast } from '../components/toast-store';
import {
  archivedBoards,
  deletedBoards,
  useAllWorkspaceBoards,
  useWorkspace,
  writes,
  type BoardDoc,
} from '../data';
import styles from './TrashPage.module.css';
import pageStyles from './Pages.module.css';

const TAB_DELETED = 0;
const TAB_ARCHIVED = 1;

export function TrashPage() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [tab, setTab] = useState<number>(TAB_DELETED);

  const { data: workspace, loading: wsLoading } = useWorkspace(workspaceId);
  const { data: allBoards, loading: boardsLoading } = useAllWorkspaceBoards(workspaceId, uid);

  if (wsLoading || boardsLoading) {
    return (
      <div className={pageStyles.center} role="status">
        <Loader size="medium" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className={pageStyles.center}>
        <Heading type="h2">Workspace not found</Heading>
        <Link to="/" className={pageStyles.link}>
          Go home
        </Link>
      </div>
    );
  }

  const role = workspace.roles[uid ?? ''] ?? null;
  const canManage = canManageWorkspace(role);

  const deletedList = deletedBoards(allBoards);
  const archivedList = archivedBoards(allBoards);

  const restoreBoard = async (board: BoardDoc) => {
    try {
      await writes.setBoardState(board.id, 'active');
      showToast(`Restored "${board.name}".`, {
        type: 'positive',
        action: {
          label: 'Undo',
          onClick: () => {
            writes.setBoardState(board.id, board.state).catch(console.error);
          },
        },
      });
    } catch (err) {
      console.error(err);
      showToast('Could not restore board.', { type: 'negative' });
    }
  };

  const currentList = tab === TAB_ARCHIVED ? archivedList : deletedList;

  return (
    <div className={styles.page}>
      <div className={styles.cover} aria-hidden="true" />
      <div className={styles.inner}>
        <header className={styles.header}>
          <Link to={`/workspaces/${workspace.id}`} className={styles.backLink}>
            <NavigationChevronLeft /> Back to {workspace.name}
          </Link>

          <div className={styles.titleRow}>
            <div className={styles.titleBlock}>
              <Heading type="h1" className={styles.name}>
                Archive & Trash
              </Heading>
              <Text type="text1" color="secondary" className={styles.description}>
                Review and restore archived or deleted boards from this workspace. Soft-deleted
                boards are permanently purged after 30 days.
              </Text>
            </div>
          </div>

          <div className={styles.tabsRow}>
            <TabList activeTabId={tab} onTabChange={setTab} stretchedUnderline>
              <Tab icon={Delete}>{`Deleted Boards (${deletedList.length})`}</Tab>
              <Tab icon={Archive}>{`Archived Boards (${archivedList.length})`}</Tab>
            </TabList>
          </div>
        </header>

        <main className={styles.content}>
          {currentList.length === 0 ? (
            <div className={styles.empty}>
              {tab === TAB_DELETED ? <Delete size="40" /> : <Archive size="40" />}
              <Text type="text1" color="secondary">
                {tab === TAB_DELETED ? 'Trash is empty.' : 'No archived boards in this workspace.'}
              </Text>
            </div>
          ) : (
            <div className={styles.list}>
              {currentList.map((board) => (
                <div key={board.id} className={styles.row}>
                  <div className={styles.itemInfo}>
                    <Board size="24" />
                    <div className={styles.itemText}>
                      <span className={styles.itemTitle}>{board.name}</span>
                      <span className={styles.itemMeta}>
                        Kind: {board.kind} · {board.columns.length} columns · {board.groups.length}{' '}
                        groups
                      </span>
                    </div>
                  </div>

                  <div className={styles.actions}>
                    {canManage && (
                      <Button
                        size="small"
                        kind="tertiary"
                        leftIcon={Retry}
                        onClick={() => restoreBoard(board)}
                      >
                        Restore
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
