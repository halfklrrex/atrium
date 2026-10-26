import { Icon, Search } from '@vibe/core';
import { Add, Check, DropdownChevronDown, DropdownChevronUp, Workspace } from '@vibe/icons';
import classNames from 'classnames';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useRecents, type WorkspaceDoc } from '../../data';
import { NoSearchResults } from '../illustrations';
import { Popover } from '../Popover';
import { useUiStore } from '../AppShell/ui-store';
import { WorkspaceTile } from '../WorkspaceTile';
import styles from './Sidebar.module.css';

/** Full-width workspace button with monday's dropdown: search, recent, mine, browse all, add. */
export function WorkspaceSwitcher({
  current,
  workspaces,
  onNavigate,
}: {
  current: WorkspaceDoc | null;
  workspaces: readonly WorkspaceDoc[];
  onNavigate?: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const openDialog = useUiStore((s) => s.openDialog);
  const { data: recents } = useRecents(user?.uid ?? null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');

  const needle = term.trim().toLowerCase();
  const matches = (w: WorkspaceDoc) => !needle || w.name.toLowerCase().includes(needle);

  // "Recent" = workspaces of the boards visited lately, plus the current one, newest first.
  const recentWorkspaces = useMemo(() => {
    const ids = [current?.id, ...recents.map((r) => r.workspaceId)].filter((id): id is string =>
      Boolean(id),
    );
    const unique = [...new Set(ids)].slice(0, 3);
    return unique.flatMap((id) => workspaces.find((w) => w.id === id) ?? []);
  }, [current, recents, workspaces]);

  const close = () => {
    setOpen(false);
    setTerm('');
  };
  const choose = (workspace: WorkspaceDoc) => {
    close();
    onNavigate?.();
    void navigate(`/workspaces/${workspace.id}`);
  };

  const renderItem = (workspace: WorkspaceDoc, scope: string) => (
    <li key={`${scope}-${workspace.id}`}>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={workspace.id === current?.id}
        className={classNames(styles.switchItem, workspace.id === current?.id && styles.rowActive)}
        onClick={() => choose(workspace)}
      >
        <WorkspaceTile icon={workspace.icon} color={workspace.color} size="xs" />
        <span className={styles.rowLabel}>{workspace.name}</span>
        {workspace.id === current?.id ? <Icon icon={Check} size={16} /> : null}
      </button>
    </li>
  );

  const recent = recentWorkspaces.filter(matches);
  const mine = workspaces.filter(matches);

  return (
    <Popover
      open={open}
      onClose={close}
      label="Switch workspace"
      className={styles.switcher}
      panelClassName={styles.switchPanel}
      trigger={
        <button
          type="button"
          className={styles.switchButton}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {current ? (
            <WorkspaceTile icon={current.icon} color={current.color} size="xs" />
          ) : (
            <Icon icon={Workspace} size={20} />
          )}
          <span className={styles.switchName}>{current?.name ?? 'No workspace'}</span>
          <Icon
            icon={open ? DropdownChevronUp : DropdownChevronDown}
            size={20}
            className={styles.switchChevron}
          />
        </button>
      }
    >
      <div className={styles.switchSearch}>
        <Search
          value={term}
          onChange={setTerm}
          placeholder="Search for a workspace"
          inputAriaLabel="Search for a workspace"
          size="small"
          autoFocus
        />
      </div>
      <div className={styles.switchScroll}>
        {recent.length > 0 ? (
          <>
            <p className={styles.menuTitle}>Recent workspaces</p>
            <ul className={styles.switchList}>{recent.map((w) => renderItem(w, 'recent'))}</ul>
          </>
        ) : null}
        <p className={styles.menuTitle}>My workspaces</p>
        {mine.length > 0 ? (
          <ul className={styles.switchList}>{mine.map((w) => renderItem(w, 'mine'))}</ul>
        ) : (
          <div className={styles.noMatch}>
            <NoSearchResults width={120} />
            <p className={styles.note}>No workspaces match</p>
          </div>
        )}
      </div>
      <div className={styles.switchFooter}>
        <button
          type="button"
          className={styles.switchItem}
          onClick={() => {
            close();
            onNavigate?.();
            void navigate('/workspaces');
          }}
        >
          <Icon icon={Workspace} size={16} />
          <span className={styles.rowLabel}>Browse all</span>
        </button>
        <button
          type="button"
          className={styles.switchItem}
          onClick={() => {
            close();
            openDialog({ type: 'newWorkspace' });
          }}
        >
          <Icon icon={Add} size={16} />
          <span className={styles.rowLabel}>Add workspace</span>
        </button>
      </div>
    </Popover>
  );
}
