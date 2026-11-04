import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon, Menu, MenuButton, MenuItem } from '@vibe/core';
import {
  Board,
  BoardPrivate,
  BoardShareable,
  DropdownChevronDown,
  DropdownChevronUp,
  NavigationChevronRight,
} from '@vibe/icons';
import classNames from 'classnames';
import { useState, type CSSProperties } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useBoardsByIds, useFavorites, type BoardDoc, type FavoriteDoc } from '../../data';
import { favoritePositionFor, moveId } from '../../lib/favorites-order';
import { boardActions } from '../boards/board-actions';
import { EmptyState } from '../EmptyState/EmptyState';
import { NoFavorites } from '../illustrations';
import { dragClickGuard, guardedNavigate } from './dragClickGuard';
import styles from './Sidebar.module.css';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Collapsible "Favorites" section: the user's starred boards across all workspaces. */
export function Favorites({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { data: favorites } = useFavorites(uid);
  const ids = favorites.map((f) => f.boardId);
  const { boards } = useBoardsByIds(ids);
  const [open, setOpen] = useState(true);
  // Optimistic order, valid only for the snapshot it was made against: the next snapshot (the
  // write confirmed, or the old order restored after an error) replaces it.
  const [optimistic, setOptimistic] = useState<{
    base: FavoriteDoc[];
    order: string[];
  } | null>(null);

  // Boards the user can no longer see, or that were archived/deleted, drop out of the list.
  const serverVisible = favorites.flatMap((f) => {
    const board = boards[f.boardId];
    return board && board.state === 'active' ? [board] : [];
  });
  const visible =
    optimistic && optimistic.base === favorites
      ? optimistic.order.flatMap((id) => serverVisible.find((b) => b.id === id) ?? [])
      : serverVisible;
  const visibleIds = visible.map((b) => b.id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space lifts and drops a row; Enter keeps following the link.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const nameOf = (id: string | number) => boards[String(id)]?.name ?? 'board';
  const placeOf = (id: string | number) => visibleIds.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up favorite ${nameOf(active.id)}, position ${placeOf(active.id)} of ${visibleIds.length}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `Favorite ${nameOf(active.id)} is over position ${placeOf(over.id)} of ${visibleIds.length}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped favorite ${nameOf(active.id)} at position ${placeOf(over.id)} of ${visibleIds.length}.`
        : `Dropped favorite ${nameOf(active.id)}.`,
    onDragCancel: ({ active }) =>
      `Reordering cancelled. Favorite ${nameOf(active.id)} did not move.`,
  };

  /** Move `boardId` to `toIndex` in the visible list: show it now, write once. */
  const moveTo = async (boardId: string, toIndex: number) => {
    if (!uid) return;
    const from = visibleIds.indexOf(boardId);
    if (from < 0 || from === toIndex || toIndex < 0 || toIndex >= visibleIds.length) return;
    const key = favoritePositionFor(favorites, visibleIds, boardId, toIndex);
    setOptimistic({ base: favorites, order: moveId(visibleIds, boardId, toIndex) });
    const ok = await boardActions.moveFavorite(uid, boardId, key);
    if (!ok) setOptimistic(null);
  };

  const reorder = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    void moveTo(String(active.id), visibleIds.indexOf(String(over.id)));
  };
  const handleDragEnd = (event: DragEndEvent) => {
    dragClickGuard.end();
    reorder(event);
  };

  return (
    <section aria-labelledby="sidebar-favorites">
      <button
        type="button"
        className={styles.sectionToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span id="sidebar-favorites">Favorites</span>
        <Icon
          icon={NavigationChevronRight}
          size={16}
          className={classNames(styles.chevron, open && styles.chevronOpen)}
        />
      </button>
      {open ? (
        visible.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={dragClickGuard.start}
            onDragEnd={handleDragEnd}
            onDragCancel={dragClickGuard.end}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable:
                  'To reorder this favorite, press Space to pick it up, use the up and down arrow keys to move it, then press Space to drop it. Press Escape to cancel.',
              },
            }}
          >
            <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
              <ul className={styles.plainList}>
                {visible.map((board, index) => (
                  <FavoriteRow
                    key={board.id}
                    board={board}
                    isFirst={index === 0}
                    isLast={index === visible.length - 1}
                    onMove={(delta) => void moveTo(board.id, index + delta)}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <EmptyState
            size="inline"
            illustration={<NoFavorites width={24} />}
            title="Star a board to find it here"
          />
        )
      ) : null}
    </section>
  );
}

function FavoriteRow({
  board,
  isFirst,
  isLast,
  onMove,
  onNavigate,
}: {
  board: BoardDoc;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: -1 | 1) => void;
  onNavigate?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: board.id, transition: prefersReducedMotion() ? null : undefined });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={classNames(styles.treeItem, isDragging && styles.dragging)}
    >
      <div className={classNames(styles.treeRow, styles.favoriteRow, menuOpen && styles.menuOpen)}>
        <NavLink
          to={`/boards/${board.id}`}
          className={({ isActive }) =>
            classNames(styles.treeMain, isActive && styles.favoriteActive)
          }
          onClick={guardedNavigate(onNavigate)}
          draggable={false}
          {...attributes}
          {...listeners}
          ref={setActivatorNodeRef}
          role="link"
        >
          <Icon
            icon={
              board.kind === 'private'
                ? BoardPrivate
                : board.kind === 'shareable'
                  ? BoardShareable
                  : Board
            }
            size={16}
            className={styles.rowIcon}
          />
          <span className={styles.rowLabel}>{board.name}</span>
        </NavLink>
        <span className={styles.rowActions}>
          <MenuButton
            size="xs"
            aria-label={`Reorder options for ${board.name}`}
            closeMenuOnItemClick
            onMenuShow={() => setMenuOpen(true)}
            onMenuHide={() => setMenuOpen(false)}
          >
            <Menu id={`favorite-menu-${board.id}`} size="medium">
              <MenuItem
                title="Move up"
                icon={DropdownChevronUp}
                disabled={isFirst}
                onClick={() => onMove(-1)}
              />
              <MenuItem
                title="Move down"
                icon={DropdownChevronDown}
                disabled={isLast}
                onClick={() => onMove(1)}
              />
            </Menu>
          </MenuButton>
        </span>
      </div>
    </li>
  );
}
