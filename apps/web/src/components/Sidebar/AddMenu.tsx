import { Icon, Menu, MenuButton, MenuDivider, MenuItem, MenuTitle } from '@vibe/core';
import { Add, Board, ClassicFolder as Folder, Workspace } from '@vibe/icons';
import { useUiStore } from '../AppShell/ui-store';
import styles from './Sidebar.module.css';

/** The blue "+" next to the workspace switcher: "Add to workspace" / "Add to account". */
export function AddMenu({
  workspaceId,
  canCreateBoards,
  canManageFolders,
}: {
  workspaceId: string | null;
  canCreateBoards: boolean;
  canManageFolders: boolean;
}) {
  const openDialog = useUiStore((s) => s.openDialog);

  return (
    <MenuButton
      component={PlusVisual}
      aria-label="Add to workspace"
      className={styles.addButton}
      closeMenuOnItemClick
      dialogPosition="bottom-start"
    >
      <Menu id="add-menu" size="medium">
        <MenuTitle caption="Add to workspace" />
        <MenuItem
          title="Board"
          icon={Board}
          disabled={!workspaceId || !canCreateBoards}
          disableReason="You can't add boards to this workspace"
          onClick={() =>
            workspaceId && openDialog({ type: 'newBoard', workspaceId, folderId: null })
          }
        />
        <MenuItem
          title="Folder"
          icon={Folder}
          disabled={!workspaceId || !canManageFolders}
          disableReason="Only workspace admins can add folders"
          onClick={() =>
            workspaceId && openDialog({ type: 'folder', workspaceId, parentFolderId: null })
          }
        />
        <MenuDivider />
        <MenuTitle caption="Add to account" />
        <MenuItem
          title="New workspace"
          icon={Workspace}
          onClick={() => openDialog({ type: 'newWorkspace' })}
        />
      </Menu>
    </MenuButton>
  );
}

function PlusVisual() {
  return (
    <span className={styles.plus}>
      <Icon icon={Add} size={20} />
    </span>
  );
}
