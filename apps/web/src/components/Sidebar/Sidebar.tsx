import { canManageWorkspace } from '@atrium/shared';
import { IconButton, Menu, MenuButton, MenuItem } from '@vibe/core';
import {
  Home,
  MyWeek,
  NavigationChevronLeft,
  NavigationChevronRight,
  Search as SearchIcon,
  Workspace,
} from '@vibe/icons';
import classNames from 'classnames';
import { useCallback, useMemo, useState } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useBoards, useFolders } from '../../data';
import type { DropResult } from '../../data/treeDnd';
import { boardActions, folderActions } from '../boards/board-actions';
import { useUiStore } from '../AppShell/ui-store';
import { useCurrentWorkspace } from '../AppShell/useCurrentWorkspace';
import { AddMenu } from './AddMenu';
import { Favorites } from './Favorites';
import { NavRow } from './NavRow';
import { SidebarTree } from './SidebarTree';
import styles from './Sidebar.module.css';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/** Folder expansion is remembered per workspace so the tree looks the same after a reload. */
function useExpandedFolders(workspaceId: string | null, activeFolderId: string | null) {
  const storageKey = workspaceId ? `atrium.sidebar.expanded.${workspaceId}` : null;
  const [stored, setStored] = useState<{ key: string | null; ids: string[] }>({
    key: null,
    ids: [],
  });

  const read = useCallback((key: string | null): string[] => {
    if (!key) return [];
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }, []);

  // Re-read when the workspace changes (derived during render, no effect needed).
  const ids = stored.key === storageKey ? stored.ids : read(storageKey);

  const toggle = useCallback(
    (folderId: string) => {
      const next = ids.includes(folderId)
        ? ids.filter((id) => id !== folderId)
        : [...ids, folderId];
      setStored({ key: storageKey, ids: next });
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // storage unavailable (private mode): the tree still works for this visit
        }
      }
    },
    [ids, storageKey],
  );

  const expanded = useMemo(
    () => new Set(activeFolderId ? [...ids, activeFolderId] : ids),
    [ids, activeFolderId],
  );
  return { expanded, toggle, expand: (id: string) => !ids.includes(id) && toggle(id) };
}

export function Sidebar() {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const navigate = useNavigate();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const mobileOpen = useUiStore((s) => s.sidebarOpen);
  const setMobileOpen = useUiStore((s) => s.setSidebarOpen);
  const closeMobile = () => setMobileOpen(false);

  const { workspace, workspaces, loading } = useCurrentWorkspace();
  const { data: folders } = useFolders(workspace?.id);
  const { data: boards, error: boardsError } = useBoards(workspace?.id, uid);
  const boardMatch = useMatch('/boards/:boardId/*');
  const activeBoardId = boardMatch?.params.boardId ?? null;
  const activeFolderId = boards.find((b) => b.id === activeBoardId)?.folderId ?? null;
  const { expanded, toggle, expand } = useExpandedFolders(workspace?.id ?? null, activeFolderId);

  // Search mode belongs to one workspace: switching workspace leaves it (derived, no effect).
  const [search, setSearch] = useState<{
    workspaceId: string | null;
    active: boolean;
    term: string;
  }>({
    workspaceId: null,
    active: false,
    term: '',
  });
  const searching = search.active && search.workspaceId === (workspace?.id ?? null);
  const filter = searching ? search.term : '';

  const role = workspace?.roles[uid] ?? null;
  const canCreateBoards = role === 'owner' || role === 'admin' || role === 'member';
  const canManageFolders = canManageWorkspace(role);

  const handleDrop = (drop: DropResult) => {
    if (!workspace) return;
    if (drop.type === 'board') {
      const board = boards.find((b) => b.id === drop.boardId);
      if (!board) return;
      if (drop.folderId) expand(drop.folderId);
      void boardActions.moveTo(board, { folderId: drop.folderId, position: drop.position });
    } else if (canManageFolders) {
      void folderActions.reorder(workspace.id, drop.folderId, drop.position);
    }
  };

  return (
    <aside
      id="app-sidebar"
      className={classNames(
        styles.sidebar,
        collapsed && styles.collapsed,
        mobileOpen && styles.mobileOpen,
      )}
      aria-label="Primary"
    >
      <div className={styles.sidebarBg} aria-hidden="true" />
      <div className={styles.inner}>
        <nav className={styles.nav} aria-label="Main">
          <NavRow to="/" end icon={Home} label="Home" onNavigate={closeMobile} />
          <NavRow to="/my-work" icon={MyWeek} label="My work" onNavigate={closeMobile} />
        </nav>

        <Favorites onNavigate={closeMobile} />

        <section className={styles.workspaceSection} aria-labelledby="sidebar-workspace">
          <div className={styles.sectionHeader}>
            <span id="sidebar-workspace" className={styles.sectionTitle}>
              Workspace
            </span>
            <span className={styles.sectionActions}>
              <MenuButton
                size="xs"
                aria-label="Workspace options"
                closeMenuOnItemClick
                componentPosition="end"
              >
                <Menu id="workspace-section-menu" size="medium">
                  <MenuItem
                    title="Browse all workspaces"
                    icon={Workspace}
                    onClick={() => {
                      closeMobile();
                      void navigate('/workspaces');
                    }}
                  />
                </Menu>
              </MenuButton>
              <IconButton
                icon={SearchIcon}
                size="xs"
                kind="tertiary"
                aria-label="Search boards"
                active={searching}
                onClick={() =>
                  setSearch({ workspaceId: workspace?.id ?? null, active: !searching, term: '' })
                }
              />
            </span>
          </div>

          <div className={styles.switchRow}>
            <WorkspaceSwitcher
              current={workspace}
              workspaces={workspaces}
              onNavigate={closeMobile}
            />
            <AddMenu
              workspaceId={workspace?.id ?? null}
              canCreateBoards={canCreateBoards}
              canManageFolders={canManageFolders}
            />
          </div>

          {searching ? (
            <input
              type="search"
              className={styles.filterInput}
              placeholder="Search boards"
              aria-label="Search boards in this workspace"
              value={filter}
              onChange={(e) => setSearch((prev) => ({ ...prev, term: e.target.value }))}
              autoFocus
            />
          ) : null}

          <div className={styles.treeScroll}>
            {boardsError ? (
              <p className={styles.note} role="alert">
                Could not load boards.
              </p>
            ) : workspace ? (
              <SidebarTree
                workspaceId={workspace.id}
                folders={folders}
                boards={boards}
                activeBoardId={activeBoardId}
                canManageFolders={canManageFolders}
                canReorder={canCreateBoards}
                filter={filter}
                expanded={expanded}
                onToggleFolder={toggle}
                onRenameBoard={(board, name) => void boardActions.rename(board, name)}
                onRenameFolder={(folder, name) =>
                  void folderActions.rename(workspace.id, folder, name)
                }
                onDrop={handleDrop}
                onNavigate={closeMobile}
              />
            ) : loading ? (
              <p className={styles.note}>Loading…</p>
            ) : null}
          </div>
        </section>
      </div>

      <button
        type="button"
        className={styles.collapseHandle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <NavigationChevronRight className={styles.handleIcon} />
        ) : (
          <NavigationChevronLeft className={styles.handleIcon} />
        )}
      </button>
    </aside>
  );
}
