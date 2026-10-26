import { canManageWorkspace } from '@atrium/shared';
import {
  AvatarGroup,
  Button,
  Loader,
  Menu,
  MenuButton,
  MenuItem,
  SplitButton,
  Tab,
  TabList,
} from '@vibe/core';
import {
  Add,
  Board,
  ClassicFolder as Folder,
  Delete,
  Locked,
  Settings,
  Time,
  ContentDirectory,
} from '@vibe/icons';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { useUiStore } from '../components/AppShell/ui-store';
import { InlineEdit } from '../components/InlineEdit';
import { showComingSoon, showToast } from '../components/toast-store';
import { UserAvatar } from '../components/UserAvatar';
import { WorkspaceTile } from '../components/WorkspaceTile';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { EmptyWorkspace } from '../components/illustrations';
import { NotFoundPage } from './NotFoundPage';
import { WorkspaceContentList, WorkspaceRecentsList } from '../components/workspace/WorkspaceLists';
import { writes, useBoards, useBoardsByIds, useFolders, useRecents, useWorkspace } from '../data';
import styles from './WorkspacePage.module.css';
import pageStyles from './Pages.module.css';

const TAB_RECENTS = 0;
const TAB_CONTENT = 1;

export function WorkspacePage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const { user, rememberWorkspace } = useAuth();
  const uid = user?.uid ?? null;
  const openDialog = useUiStore((s) => s.openDialog);
  const { data: workspace, loading } = useWorkspace(workspaceId);
  const { data: folders } = useFolders(workspaceId);
  const { data: boards } = useBoards(workspaceId, uid);
  const { data: recents } = useRecents(uid);
  const [chosenTab, setTab] = useState<number | null>(null);
  const workspaceFound = workspace !== null;

  // Remember the last workspace the user actually opened.
  useEffect(() => {
    if (workspaceId && workspaceFound) rememberWorkspace(workspaceId);
  }, [workspaceId, workspaceFound, rememberWorkspace]);

  const recentIds = useMemo(
    () => recents.filter((r) => r.workspaceId === workspaceId).map((r) => r.boardId),
    [recents, workspaceId],
  );
  const { boards: recentBoards } = useBoardsByIds(recentIds);
  const recentList = recentIds.flatMap((id) => {
    const board = recentBoards[id];
    return board && board.state === 'active' ? [board] : [];
  });

  // Like monday, open on Recents - but only once there is something to show there.
  const tab = chosenTab ?? (recentList.length > 0 ? TAB_RECENTS : TAB_CONTENT);

  if (loading) {
    return (
      <div className={pageStyles.center} role="status">
        <Loader size="medium" />
      </div>
    );
  }

  // Missing workspaces and ones the user cannot read look the same on purpose.
  if (!workspace) return <NotFoundPage />;

  const role = workspace.roles[uid ?? ''] ?? null;
  const canManage = canManageWorkspace(role);
  const canCreateBoards = role === 'owner' || role === 'admin' || role === 'member';
  const memberIds = workspace.memberIds;

  const save = (patch: Parameters<typeof writes.updateWorkspace>[1]) => {
    writes.updateWorkspace(workspace.id, patch).catch((error: unknown) => {
      console.error('Could not update the workspace', error);
      showToast('Could not save your change.', { type: 'negative' });
    });
  };

  const newBoard = () =>
    openDialog({ type: 'newBoard', workspaceId: workspace.id, folderId: null });
  const newFolder = () =>
    openDialog({ type: 'folder', workspaceId: workspace.id, parentFolderId: null });
  const isEmpty = boards.length === 0 && folders.length === 0;

  return (
    <div className={styles.page}>
      <div className={styles.cover} aria-hidden="true" />

      <div className={styles.inner}>
        <header className={styles.header}>
          <WorkspaceTile
            icon={workspace.icon}
            color={workspace.color}
            size="xl"
            className={styles.avatar}
          />
          <div className={styles.titleBlock}>
            <InlineEdit
              value={workspace.name}
              ariaLabel="Workspace name"
              readOnly={!canManage}
              maxLength={80}
              onCommit={(name) => save({ name })}
              className={styles.name}
            />
            <InlineEdit
              value={workspace.description}
              ariaLabel="Workspace description"
              placeholder="Add workspace description"
              readOnly={!canManage}
              allowEmpty
              maxLength={500}
              onCommit={(description) => save({ description })}
              className={styles.description}
            />
          </div>
          <div className={styles.headerActions}>
            <Button kind="tertiary" size="small" onClick={() => showComingSoon('Feedback')}>
              Feedback
            </Button>
            <AvatarGroup max={3} size="small" type="img">
              {memberIds.map((id) => (
                <UserAvatar key={id} uid={id} />
              ))}
            </AvatarGroup>
            <Button size="small" onClick={() => showComingSoon('Inviting members')}>
              Invite / {memberIds.length}
            </Button>
            <MenuButton size="small" aria-label="Workspace options" closeMenuOnItemClick>
              <Menu id="workspace-page-menu" size="medium">
                <MenuItem
                  title="Workspace settings"
                  icon={Settings}
                  disabled={!canManage}
                  disableReason="Only workspace admins can change settings"
                  onClick={() =>
                    openDialog({ type: 'workspaceSettings', workspaceId: workspace.id })
                  }
                />
                <MenuItem
                  title="Archive & Trash"
                  icon={Delete}
                  onClick={() => navigate(`/workspaces/${workspace.id}/trash`)}
                />
              </Menu>
            </MenuButton>
          </div>
        </header>

        <div className={styles.tabsRow}>
          <TabList activeTabId={tab} onTabChange={setTab} stretchedUnderline>
            <Tab icon={Time}>Recents</Tab>
            <Tab icon={ContentDirectory}>Content</Tab>
            <Tab icon={Locked} disabled>
              Permissions
            </Tab>
          </TabList>
          <SplitButton
            size="small"
            leftIcon={Add}
            disabled={!canCreateBoards}
            onClick={newBoard}
            shouldCloseOnClickInsideDialog
            secondaryDialogContent={
              <Menu id="workspace-add-menu" size="medium">
                <MenuItem title="New board" icon={Board} onClick={newBoard} />
                <MenuItem
                  title="New folder"
                  icon={Folder}
                  disabled={!canManage}
                  disableReason="Only workspace admins can add folders"
                  onClick={newFolder}
                />
              </Menu>
            }
          >
            Add
          </SplitButton>
        </div>

        <div className={styles.tabBody}>
          {isEmpty ? (
            <EmptyState
              size="page"
              className={styles.empty}
              illustration={<EmptyWorkspace />}
              title="This workspace is empty"
              body="Create a board to start planning, or add a folder to organise them."
              primaryAction={{
                label: 'Create board',
                disabled: !canCreateBoards,
                onClick: newBoard,
              }}
              secondaryAction={{
                label: 'Add folder',
                variant: 'button',
                disabled: !canManage,
                onClick: newFolder,
              }}
            />
          ) : tab === TAB_RECENTS ? (
            recentList.length > 0 ? (
              <WorkspaceRecentsList boards={recentList} />
            ) : (
              <p className={styles.muted}>Boards you open in this workspace will show up here.</p>
            )
          ) : tab === TAB_CONTENT ? (
            <WorkspaceContentList folders={folders} boards={boards} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
