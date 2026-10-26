import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon, MenuButton, Menu, MenuItem, MenuDivider } from '@vibe/core';
import {
  Board as BoardIcon,
  BoardPrivate,
  BoardShareable,
  Delete,
  Edit,
  ClassicFolder as FolderIcon,
  NavigationChevronRight,
  Add,
  AddSmall,
} from '@vibe/icons';
import classNames from 'classnames';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import {
  buildTree,
  filterTree,
  flattenTree,
  type BoardDoc,
  type FolderDoc,
  type FolderNode,
  type TreeRow,
} from '../../data';
import { computeDrop, type DropResult } from '../../data/treeDnd';
import { BoardMenu } from '../boards/BoardMenu';
import { EmptyState } from '../EmptyState/EmptyState';
import { InlineEdit } from '../InlineEdit';
import { useUiStore } from '../AppShell/ui-store';
import styles from './Sidebar.module.css';

export interface SidebarTreeProps {
  workspaceId: string;
  folders: readonly FolderDoc[];
  boards: readonly BoardDoc[];
  activeBoardId: string | null;
  /** Owners/admins may create, recolour, rename and delete folders. */
  canManageFolders: boolean;
  /** Drag and drop is available to anyone who can edit boards. */
  canReorder: boolean;
  /** Case-insensitive board-name filter from the search box. */
  filter: string;
  expanded: ReadonlySet<string>;
  onToggleFolder: (folderId: string) => void;
  onRenameBoard: (board: BoardDoc, name: string) => void;
  onRenameFolder: (folder: FolderDoc, name: string) => void;
  onDrop: (drop: DropResult) => void;
  onNavigate?: () => void;
}

const boardIconFor = (kind: BoardDoc['kind']) =>
  kind === 'private' ? BoardPrivate : kind === 'shareable' ? BoardShareable : BoardIcon;

/** The workspace's folders and boards, ordered, collapsible and drag-and-drop sortable. */
export function SidebarTree({
  workspaceId,
  folders,
  boards,
  activeBoardId,
  canManageFolders,
  canReorder,
  filter,
  expanded,
  onToggleFolder,
  onRenameBoard,
  onRenameFolder,
  onDrop,
  onNavigate,
}: SidebarTreeProps) {
  const openDialog = useUiStore((s) => s.openDialog);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const filtering = filter.trim().length > 0;
  const tree = useMemo(() => buildTree(folders, boards), [folders, boards]);
  const visibleTree = useMemo(
    () => (filtering ? filterTree(tree, filter) : tree),
    [tree, filter, filtering],
  );
  const expandedIds = useMemo(
    () => (filtering ? new Set(folders.map((f) => f.id)) : expanded),
    [filtering, folders, expanded],
  );
  const rows = useMemo(() => flattenTree(visibleTree, expandedIds), [visibleTree, expandedIds]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragEnabled = canReorder && !filtering && renaming === null;

  const clearDrag = () => {
    setActiveKey(null);
    setOverKey(null);
  };
  const handleDragOver = (event: DragOverEvent) =>
    setOverKey(event.over ? String(event.over.id) : null);
  const handleDragEnd = (event: DragEndEvent) => {
    const drop = event.over
      ? computeDrop(tree, String(event.active.id), String(event.over.id))
      : null;
    clearDrag();
    if (drop) onDrop(drop);
  };

  if (rows.length === 0) {
    if (filtering) return <p className={styles.note}>No boards match your search.</p>;
    return (
      <EmptyState
        size="inline"
        title="No boards yet"
        primaryAction={
          canReorder
            ? {
                label: '+ Create board',
                variant: 'link',
                onClick: () => openDialog({ type: 'newBoard', workspaceId, folderId: null }),
              }
            : undefined
        }
      />
    );
  }

  const draggingBoard = activeKey?.startsWith('board:') ?? false;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setActiveKey(String(event.active.id))}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={clearDrag}
    >
      <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
        <ul className={styles.tree} role="tree" aria-label="Boards and folders">
          {rows.map((row) => (
            <SortableItem key={row.key} row={row} disabled={!dragEnabled}>
              {row.node.type === 'folder' ? (
                <FolderRowView
                  node={row.node}
                  workspaceId={workspaceId}
                  expanded={expandedIds.has(row.node.folder.id)}
                  canManage={canManageFolders}
                  isDropTarget={draggingBoard && overKey === row.key && activeKey !== row.key}
                  renaming={renaming === row.key}
                  onRenamingChange={(on) => setRenaming(on ? row.key : null)}
                  onToggle={() =>
                    onToggleFolder(row.node.type === 'folder' ? row.node.folder.id : '')
                  }
                  onRename={(name) => {
                    if (row.node.type === 'folder') onRenameFolder(row.node.folder, name);
                  }}
                  canCreateSubFolder={row.depth === 0}
                />
              ) : (
                <BoardRowView
                  board={row.node.board}
                  active={row.node.board.id === activeBoardId}
                  renaming={renaming === row.key}
                  onRenamingChange={(on) => setRenaming(on ? row.key : null)}
                  onRename={(name) => {
                    if (row.node.type === 'board') onRenameBoard(row.node.board, name);
                  }}
                  onNavigate={onNavigate}
                />
              )}
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({
  row,
  disabled,
  children,
}: {
  row: TreeRow;
  disabled: boolean;
  children: ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.key,
    disabled,
  });
  const style: CSSProperties & { '--depth': number } = {
    transform: CSS.Translate.toString(transform),
    transition,
    '--depth': row.depth,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={classNames(styles.treeItem, isDragging && styles.dragging)}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={false}
      {...listeners}
    >
      {children}
    </li>
  );
}

function BoardRowView({
  board,
  active,
  renaming,
  onRenamingChange,
  onRename,
  onNavigate,
}: {
  board: BoardDoc;
  active: boolean;
  renaming: boolean;
  onRenamingChange: (on: boolean) => void;
  onRename: (name: string) => void;
  onNavigate?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={classNames(
        styles.treeRow,
        active && styles.rowActive,
        menuOpen && styles.menuOpen,
      )}
    >
      {renaming ? (
        <div className={styles.treeMain}>
          <Icon icon={boardIconFor(board.kind)} size={16} className={styles.rowIcon} />
          <InlineEdit
            value={board.name}
            ariaLabel="Board name"
            maxLength={120}
            editing
            onEditingChange={onRenamingChange}
            onCommit={onRename}
            className={styles.treeEdit}
          />
        </div>
      ) : (
        <NavLink
          to={`/boards/${board.id}`}
          className={styles.treeMain}
          onClick={onNavigate}
          onDoubleClick={() => onRenamingChange(true)}
          draggable={false}
        >
          <Icon icon={boardIconFor(board.kind)} size={16} className={styles.rowIcon} />
          <span className={styles.rowLabel}>{board.name}</span>
        </NavLink>
      )}
      <span className={styles.rowActions}>
        <BoardMenu
          board={board}
          size="xs"
          onRename={() => onRenamingChange(true)}
          onMenuShow={() => setMenuOpen(true)}
          onMenuHide={() => setMenuOpen(false)}
        />
      </span>
    </div>
  );
}

function FolderRowView({
  node,
  workspaceId,
  expanded,
  canManage,
  canCreateSubFolder,
  isDropTarget,
  renaming,
  onRenamingChange,
  onToggle,
  onRename,
}: {
  node: FolderNode;
  workspaceId: string;
  expanded: boolean;
  canManage: boolean;
  canCreateSubFolder: boolean;
  isDropTarget: boolean;
  renaming: boolean;
  onRenamingChange: (on: boolean) => void;
  onToggle: () => void;
  onRename: (name: string) => void;
}) {
  const openDialog = useUiStore((s) => s.openDialog);
  const [menuOpen, setMenuOpen] = useState(false);
  const { folder } = node;

  const icon = (
    <>
      <Icon
        icon={NavigationChevronRight}
        size={16}
        className={classNames(styles.chevron, expanded && styles.chevronOpen)}
      />
      <Icon
        icon={FolderIcon}
        size={16}
        className={styles.rowIcon}
        style={{ color: folder.color }}
      />
    </>
  );

  return (
    <div
      className={classNames(
        styles.treeRow,
        menuOpen && styles.menuOpen,
        isDropTarget && styles.dropTarget,
      )}
    >
      {renaming ? (
        <div className={styles.treeMain}>
          {icon}
          <InlineEdit
            value={folder.name}
            ariaLabel="Folder name"
            maxLength={80}
            editing
            onEditingChange={onRenamingChange}
            onCommit={onRename}
            className={styles.treeEdit}
          />
        </div>
      ) : (
        <button
          type="button"
          className={styles.treeMain}
          aria-expanded={expanded}
          onClick={onToggle}
          onDoubleClick={() => canManage && onRenamingChange(true)}
        >
          {icon}
          <span className={styles.rowLabel}>{folder.name}</span>
        </button>
      )}
      <span className={styles.rowActions}>
        <span className={styles.count} aria-label={`${node.boardCount} boards`}>
          {node.boardCount}
        </span>
        <MenuButton
          size="xs"
          aria-label={`Options for folder ${folder.name}`}
          closeMenuOnItemClick
          onMenuShow={() => setMenuOpen(true)}
          onMenuHide={() => setMenuOpen(false)}
        >
          <Menu id={`folder-menu-${folder.id}`} size="medium">
            <MenuItem
              title="Add board to folder"
              icon={Add}
              onClick={() => openDialog({ type: 'newBoard', workspaceId, folderId: folder.id })}
            />
            {canManage && canCreateSubFolder ? (
              <MenuItem
                title="Add sub-folder"
                icon={AddSmall}
                onClick={() =>
                  openDialog({ type: 'folder', workspaceId, parentFolderId: folder.id })
                }
              />
            ) : null}
            {canManage ? <MenuDivider /> : null}
            {canManage ? (
              <MenuItem title="Rename" icon={Edit} onClick={() => onRenamingChange(true)} />
            ) : null}
            {canManage ? (
              <MenuItem
                title="Change color"
                icon={FolderIcon}
                onClick={() => openDialog({ type: 'folder', workspaceId, folderId: folder.id })}
              />
            ) : null}
            {canManage ? <MenuDivider /> : null}
            {canManage ? (
              <MenuItem
                title="Delete folder"
                icon={Delete}
                onClick={() =>
                  openDialog({ type: 'deleteFolder', workspaceId, folderId: folder.id })
                }
              />
            ) : null}
          </Menu>
        </MenuButton>
      </span>
    </div>
  );
}
