import { canEditBoard, canManageBoard, csvFileName, resolveBoardRole } from '@atrium/shared';
import { Menu, MenuButton, MenuDivider, MenuItem, MenuTitle } from '@vibe/core';
import {
  Archive,
  Check,
  Delete,
  Download,
  Duplicate,
  Edit,
  Favorite,
  Gallery,
  ClassicFolder as Folder,
  Locked,
  Move,
  Remove,
  Time,
} from '@vibe/icons';
import { useMatch, useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import {
  useBoards,
  useFavorites,
  useFolders,
  useItems,
  useUserLookup,
  useWorkspace,
  type BoardDoc,
} from '../../data';
import { useBoardFilter, useHiddenColumnIds } from '../board-filters';
import { buildColumnViews, buildGroupModels } from '../board-table/table-model';
import { useTableStore } from '../board-table/table-store';
import { showToast } from '../toast-store';
import { useUiStore } from '../AppShell/ui-store';
import { FavoriteFilled } from './FavoriteStar';
import { boardActions } from './board-actions';
import { boardCsvText, buildBoardCsvRows, downloadCsv } from './board-export';
import { canLeaveBoard } from './board-sharing';
import { folderChoices } from './folder-choices';

interface BoardMenuProps {
  board: BoardDoc;
  /** Start inline rename in the surrounding UI (sidebar row or header). Hidden when omitted. */
  onRename?: () => void;
  /** Opens the board's Activity log panel. The entry is hidden when omitted (only the header has the panel). */
  onActivityLog?: () => void;
  /**
   * True when the menu belongs to the open board view (the header): "Export to CSV" then exports
   * the rows that view shows (filters, search, sort, hidden columns). Otherwise it exports every
   * active item in group order.
   */
  exportOpenView?: boolean;
  size?: 'xxs' | 'xs' | 'small';
  className?: string;
  onMenuShow?: () => void;
  onMenuHide?: () => void;
}

/** "⋯" menu with every board action (spec section 4); shared by the sidebar, header and lists. */
export function BoardMenu({
  board,
  onRename,
  onActivityLog,
  exportOpenView = false,
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
      <BoardMenuContent
        board={board}
        onRename={onRename}
        onActivityLog={onActivityLog}
        exportOpenView={exportOpenView}
      />
    </MenuButton>
  );
}

/** Separate component so the data listeners only run while the menu is open. */
function BoardMenuContent({
  board,
  onRename,
  onActivityLog,
  exportOpenView,
}: Pick<BoardMenuProps, 'board' | 'onRename' | 'onActivityLog' | 'exportOpenView'>) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const navigate = useNavigate();
  const openBoardMatch = useMatch('/boards/:boardId');
  const openDialog = useUiStore((s) => s.openDialog);
  const { data: workspace } = useWorkspace(board.workspaceId);
  const { data: boards } = useBoards(board.workspaceId, uid);
  const { data: folders } = useFolders(board.workspaceId);
  const { data: favorites } = useFavorites(uid);
  const { data: items, loading: itemsLoading } = useItems(board.id);
  const memberLookup = useUserLookup(board.workspaceId);
  const { filterState } = useBoardFilter(board.id);
  const viewHiddenIds = useHiddenColumnIds(board.id);
  const search = useTableStore((s) => s.search);

  const role = resolveBoardRole(board, uid, workspace?.roles[uid]);
  const canEdit = canEditBoard(role);
  const isOwner = canManageBoard(role);
  const canLeave = canLeaveBoard(board, uid);
  const isFavorite = favorites.some((f) => f.boardId === board.id);

  const leaveIfOpen = () => {
    if (openBoardMatch?.params.boardId === board.id) {
      void navigate(`/workspaces/${board.workspaceId}`);
    }
  };

  const exportCsv = () => {
    try {
      const allColumns = buildColumnViews(board.columns);
      const models = buildGroupModels({
        groups: board.groups,
        items,
        columns: allColumns,
        subitemColumns: buildColumnViews(board.subitemColumns ?? []),
        search: exportOpenView ? search.trim() : '',
        filterState: exportOpenView ? filterState : undefined,
        userLookup: (id) => memberLookup(id)?.name,
      });
      const rows = buildBoardCsvRows({
        board,
        items: models.flatMap((m) => m.items),
        subitems: items.filter((i) => i.parentItemId !== null && i.parentItemId !== undefined),
        columns: board.columns,
        subitemColumns: board.subitemColumns ?? [],
        hiddenColumnIds: exportOpenView ? viewHiddenIds : [],
        groups: board.groups,
        personNames: (id) => memberLookup(id)?.name,
      });
      downloadCsv(csvFileName(board.name), boardCsvText(rows));
      const count = rows.length - 1;
      showToast(`Exported ${count} ${count === 1 ? 'item' : 'items'}`, { type: 'positive' });
    } catch (error) {
      console.error('Could not export the board', error);
      showToast('Could not export the board', { type: 'negative' });
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
      <MenuItem
        title="Save as template"
        icon={Gallery}
        disabled={!workspace || workspace.roles[uid] === 'viewer'}
        onClick={() => openDialog({ type: 'saveTemplate', boardId: board.id })}
      />
      <MenuItem title="Export to CSV" icon={Download} disabled={itemsLoading} onClick={exportCsv} />
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
      {onActivityLog || isOwner ? <MenuDivider /> : null}
      {onActivityLog ? <MenuItem title="Activity log" icon={Time} onClick={onActivityLog} /> : null}
      {isOwner ? (
        <MenuItem
          title="Board permissions"
          icon={Locked}
          onClick={() => openDialog({ type: 'shareBoard', boardId: board.id })}
        />
      ) : null}
      {canLeave ? (
        <MenuItem
          title="Leave board"
          icon={Remove}
          onClick={() => {
            void boardActions.leave(board).then((ok) => ok && leaveIfOpen());
          }}
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
