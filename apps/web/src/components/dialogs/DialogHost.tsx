import { useUiStore } from '../AppShell/ui-store';
import { AboutDialog } from './AboutDialog';
import { ShareBoardDialog } from '../boards/ShareBoardDialog';
import { ShareDashboardDialog } from '../dashboard/ShareDashboardDialog';
import { NewBoardDialog } from './BoardDialogs';
import { NewDashboardDialog } from './DashboardDialogs';
import { DashboardBoardsDialog } from '../dashboard/DashboardBoardsDialog';
import { MembersDialog } from '../membership/MembersDialog';
import { DeleteFolderDialog, FolderDialog } from './FolderDialogs';
import { SaveAsTemplateDialog } from '../templates/SaveAsTemplateDialog';
import { SearchDialog } from '../search/SearchDialog';
import { NotificationSettingsDialog } from './NotificationSettingsDialog';
import { NewWorkspaceDialog, WorkspaceSettingsDialog } from './WorkspaceDialogs';

/** Renders the single dialog described by the UI store (opened from menus anywhere in the app). */
export function DialogHost() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  if (!dialog) return null;

  switch (dialog.type) {
    case 'newWorkspace':
      return <NewWorkspaceDialog onClose={close} />;
    case 'workspaceSettings':
      return <WorkspaceSettingsDialog workspaceId={dialog.workspaceId} onClose={close} />;
    case 'newBoard':
      return (
        <NewBoardDialog
          workspaceId={dialog.workspaceId}
          folderId={dialog.folderId}
          initialKind={dialog.kind}
          onClose={close}
        />
      );
    case 'newDashboard':
      return (
        <NewDashboardDialog
          workspaceId={dialog.workspaceId}
          folderId={dialog.folderId}
          initialKind={dialog.kind}
          onClose={close}
        />
      );
    case 'dashboardBoards':
      return <DashboardBoardsDialog dashboardId={dialog.dashboardId} onClose={close} />;
    case 'shareDashboard':
      return <ShareDashboardDialog dashboardId={dialog.dashboardId} onClose={close} />;
    case 'saveTemplate':
      return <SaveAsTemplateDialog boardId={dialog.boardId} onClose={close} />;
    case 'folder':
      return (
        <FolderDialog
          workspaceId={dialog.workspaceId}
          folderId={dialog.folderId}
          parentFolderId={dialog.parentFolderId}
          onClose={close}
        />
      );
    case 'deleteFolder':
      return (
        <DeleteFolderDialog
          workspaceId={dialog.workspaceId}
          folderId={dialog.folderId}
          onClose={close}
        />
      );
    case 'shareBoard':
      return <ShareBoardDialog boardId={dialog.boardId} onClose={close} />;
    case 'members':
      return (
        <MembersDialog workspaceId={dialog.workspaceId} initialTab={dialog.tab} onClose={close} />
      );
    case 'notificationSettings':
      return <NotificationSettingsDialog onClose={close} />;
    case 'search':
      return <SearchDialog initialTerm={dialog.initialTerm} onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
  }
}
