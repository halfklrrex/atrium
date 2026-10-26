import { Icon } from '@vibe/core';
import { Board, BoardPrivate, BoardShareable, NavigationChevronRight } from '@vibe/icons';
import classNames from 'classnames';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useBoardsByIds, useFavorites } from '../../data';
import { EmptyState } from '../EmptyState/EmptyState';
import { NoFavorites } from '../illustrations';
import styles from './Sidebar.module.css';

/** Collapsible "Favorites" section: the user's starred boards across all workspaces. */
export function Favorites({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const { data: favorites } = useFavorites(user?.uid ?? null);
  const ids = useMemo(() => favorites.map((f) => f.boardId), [favorites]);
  const { boards } = useBoardsByIds(ids);
  const [open, setOpen] = useState(true);

  // Boards the user can no longer see, or that were archived/deleted, drop out of the list.
  const visible = favorites.flatMap((f) => {
    const board = boards[f.boardId];
    return board && board.state === 'active' ? [board] : [];
  });

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
          <ul className={styles.plainList}>
            {visible.map((board) => (
              <li key={board.id}>
                <NavLink
                  to={`/boards/${board.id}`}
                  className={({ isActive }) => classNames(styles.row, isActive && styles.rowActive)}
                  onClick={onNavigate}
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
              </li>
            ))}
          </ul>
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
