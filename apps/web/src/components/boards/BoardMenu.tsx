import { canEditBoard, canManageBoard, resolveBoardRole } from '@atrium/shared';
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
  Print,
  Remove,
  Time,
} from '@vibe/icons';
import { useMatch, useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import {
  useBoardViews,
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
import { useUiStore } from '../AppShell/ui-store';
import { FavoriteFilled } from './FavoriteStar';
import { boardActions } from './board-actions';
import { buildBoardCsvRows, type BoardCsvInput } from './board-export';
import { runExport, type ExportFormat } from './export-run';
import { buildBoardWorkbookData } from './workbook-data';

import { canLeaveBoard } from './board-sharing';
import { folderChoices } from './folder-choices';
import { idFromSlugParam, workspacePath } from '../../lib/paths';

interface BoardMenuProps {
  board: BoardDoc;
  /** Start inline rename in the surrounding UI (sidebar row or header). Hidden when omitted. */
  onRename?: () => void;
  /** Opens the board's Activity log panel. The entry is hidden when omitted (only the header has the panel). */
  onActivityLog?: () => void;
  /**
   * True when the menu belongs to the open board view (the header): "Export" then exports
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
  const { data: views } = useBoardViews(board.id, uid);
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
    if (idFromSlugParam(openBoardMatch?.params.boardId) === board.id) {
      void navigate(workspacePath({ id: board.workspaceId, name: workspace?.name }));
    }
  };

  /** The rows and columns to export: the open view's (filters, search, hidden columns) or all. */
  const exportInput = (): BoardCsvInput => {
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
    return {
      board,
      items: models.flatMap((m) => m.items),
      subitems: items.filter((i) => i.parentItemId !== null && i.parentItemId !== undefined),
      columns: board.columns,
      subitemColumns: board.subitemColumns ?? [],
      hiddenColumnIds: exportOpenView ? viewHiddenIds : [],
      groups: board.groups,
      personNames: (id) => memberLookup(id)?.name,
    };
  };

  const exportBoard = (format: ExportFormat) =>
    runExport({
      format,
      boardName: board.name,
      itemCount: items.length,
      buildRows: () => buildBoardCsvRows(exportInput()),
      buildWorkbook: () =>
        buildBoardWorkbookData({
          ...exportInput(),
          boardName: board.name,
          now: new Date(),
          views,
          allItems: items,
        }),
    });

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
      <MenuItem title="Export" icon={Download} disabled={itemsLoading}>
        <Menu id={`export-menu-${board.id}`} size="medium">
          <MenuItem title="CSV" onClick={() => void exportBoard('csv')} />
          <MenuItem title="Excel (.xlsx)" onClick={() => void exportBoard('xlsx')} />
        </Menu>
      </MenuItem>
      <MenuItem title="Print" icon={Print} onClick={() => window.print()} />
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
