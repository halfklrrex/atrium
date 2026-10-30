import { useUiStore } from '../AppShell/ui-store';
import { AboutDialog } from './AboutDialog';
import { BoardPermissionsDialog, NewBoardDialog } from './BoardDialogs';
import { MembersDialog } from '../membership/MembersDialog';
import { DeleteFolderDialog, FolderDialog } from './FolderDialogs';
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
    case 'boardPermissions':
      return <BoardPermissionsDialog boardId={dialog.boardId} onClose={close} />;
    case 'members':
      return (
        <MembersDialog workspaceId={dialog.workspaceId} initialTab={dialog.tab} onClose={close} />
      );
    case 'notificationSettings':
      return <NotificationSettingsDialog onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
  }
}
