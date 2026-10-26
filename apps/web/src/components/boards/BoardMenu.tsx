import { canEditBoard, canManageBoard, resolveBoardRole } from '@atrium/shared';
import { Menu, MenuButton, MenuDivider, MenuItem, MenuTitle } from '@vibe/core';
import {
  Archive,
  Check,
  Delete,
  Duplicate,
  Edit,
  Favorite,
  ClassicFolder as Folder,
  Locked,
  Move,
} from '@vibe/icons';
import { useMatch, useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useBoards, useFavorites, useFolders, useWorkspace, type BoardDoc } from '../../data';
import { useUiStore } from '../AppShell/ui-store';
import { FavoriteFilled } from './FavoriteStar';
import { boardActions } from './board-actions';
import { folderChoices } from './folder-choices';

interface BoardMenuProps {
  board: BoardDoc;
  /** Start inline rename in the surrounding UI (sidebar row or header). Hidden when omitted. */
  onRename?: () => void;
  size?: 'xxs' | 'xs' | 'small';
  className?: string;
  onMenuShow?: () => void;
  onMenuHide?: () => void;
}

/** "⋯" menu with every board action (spec section 4); shared by the sidebar, header and lists. */
export function BoardMenu({
  board,
  onRename,
  size = 'xs',
  className,
  onMenuShow,
  onMenuHide,
}: BoardMenuProps) {
  return (
    <MenuButton
      size={size}
      className={className}
      aria-label={`Options for ${board.name}`}
      closeMenuOnItemClick
      onMenuShow={onMenuShow}
      onMenuHide={onMenuHide}
    >
      <BoardMenuContent board={board} onRename={onRename} />
    </MenuButton>
  );
}

/** Separate component so the data listeners only run while the menu is open. */
function BoardMenuContent({ board, onRename }: Pick<BoardMenuProps, 'board' | 'onRename'>) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const navigate = useNavigate();
  const openBoardMatch = useMatch('/boards/:boardId');
  const openDialog = useUiStore((s) => s.openDialog);
  const { data: workspace } = useWorkspace(board.workspaceId);
  const { data: boards } = useBoards(board.workspaceId, uid);
  const { data: folders } = useFolders(board.workspaceId);
  const { data: favorites } = useFavorites(uid);

  const role = resolveBoardRole(board, uid, workspace?.roles[uid]);
  const canEdit = canEditBoard(role);
  const isOwner = canManageBoard(role);
  const isFavorite = favorites.some((f) => f.boardId === board.id);

  const leaveIfOpen = () => {
    if (openBoardMatch?.params.boardId === board.id) {
      void navigate(`/workspaces/${board.workspaceId}`);
    }
  };

  return (
    <Menu id={`board-menu-${board.id}`} size="medium">
      <MenuTitle caption="Board options" />
      {onRename && canEdit ? <MenuItem title="Rename" icon={Edit} onClick={onRename} /> : null}
      <MenuItem
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        icon={isFavorite ? FavoriteFilled : Favorite}
        onClick={() => void boardActions.toggleFavorite(uid, board, favorites)}
      />
      <MenuItem
        title="Duplicate board"
        icon={Duplicate}
        disabled={!workspace || workspace.roles[uid] === 'viewer'}
        onClick={() => void boardActions.duplicate(uid, board, boards)}
      />
      {canEdit ? (
        <MenuItem title="Move to folder" icon={Move}>
          <Menu id={`move-menu-${board.id}`} size="medium">
            <MenuItem
              title="Workspace root"
              icon={board.folderId === null ? Check : undefined}
              onClick={() => void boardActions.moveToFolder(board, null, boards)}
            />
            {folderChoices(folders).map(({ folder, label }) => (
              <MenuItem
                key={folder.id}
                title={label}
                icon={board.folderId === folder.id ? Check : Folder}
                onClick={() => void boardActions.moveToFolder(board, folder.id, boards)}
              />
            ))}
          </Menu>
        </MenuItem>
      ) : null}
      {isOwner ? <MenuDivider /> : null}
      {isOwner ? (
        <MenuItem
          title="Board permissions"
          icon={Locked}
          onClick={() => openDialog({ type: 'boardPermissions', boardId: board.id })}
        />
      ) : null}
      {isOwner ? <MenuDivider /> : null}
      {isOwner ? (
        <MenuItem
          title="Archive board"
          icon={Archive}
          onClick={() => {
            void boardActions.retire(board, 'archived').then((ok) => ok && leaveIfOpen());
          }}
        />
      ) : null}
      {isOwner ? (
        <MenuItem
          title="Delete board"
          icon={Delete}
          onClick={() => {
            void boardActions.retire(board, 'deleted').then((ok) => ok && leaveIfOpen());
          }}
        />
      ) : null}
    </Menu>
  );
}
