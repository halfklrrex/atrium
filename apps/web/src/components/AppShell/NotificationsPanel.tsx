import { IconButton, Search, Tab, TabList, Toggle } from '@vibe/core';
import { CloseSmall, Menu as DotsIcon, Settings } from '@vibe/icons';
import classNames from 'classnames';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../EmptyState/EmptyState';
import { AllCaughtUp } from '../illustrations';
import { showComingSoon } from '../toast-store';
import styles from './NotificationsPanel.module.css';
import { useUiStore } from './ui-store';

/**
 * Right-hand notifications panel, opened from the top bar's bell. UI shell only: it always shows
 * the "all caught up" state until real notifications arrive in P4.
 */
export function NotificationsPanel() {
  const open = useUiStore((s) => s.notificationsOpen);
  const setOpen = useUiStore((s) => s.setNotificationsOpen);
  const [tab, setTab] = useState(0);
  const [term, setTerm] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = document.querySelector<HTMLElement>('[data-notifications-trigger]');
    const returnTo = trigger?.querySelector('button') ?? null;
    // Move focus into the panel so keyboard users land in it.
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      returnTo?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel?.contains(target)) return;
      // The bell toggles the panel itself.
      if (trigger?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, setOpen]);

  return (
    <aside
      ref={panelRef}
      id="notifications-panel"
      className={classNames(styles.panel, open && styles.open)}
      aria-label="Notifications"
      inert={!open}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Notifications</h2>
        <div className={styles.headerActions}>
          <IconButton
            icon={Settings}
            kind="tertiary"
            size="small"
            aria-label="Notification settings"
            onClick={() => showComingSoon('Notification settings')}
          />
          <IconButton
            icon={DotsIcon}
            kind="tertiary"
            size="small"
            aria-label="More notification actions"
            onClick={() => showComingSoon('Notification actions')}
          />
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            aria-label="Close notifications"
            onClick={() => {
              setOpen(false);
              document.querySelector<HTMLElement>('[data-notifications-trigger] button')?.focus();
            }}
          >
            <CloseSmall aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={styles.tabs}>
        <TabList activeTabId={tab} onTabChange={setTab} size="sm">
          <Tab>All</Tab>
          <Tab>Mentioned</Tab>
          <Tab>Assigned to me</Tab>
        </TabList>
      </div>

      <div className={styles.filters}>
        <div className={styles.search}>
          <Search
            value={term}
            onChange={setTerm}
            placeholder="Search notifications by people, boards, and more…"
            inputAriaLabel="Search notifications"
            size="small"
          />
        </div>
        <Toggle
          isSelected={unreadOnly}
          onChange={setUnreadOnly}
          aria-label="Unread only"
          areLabelsHidden
        />
        <span className={styles.toggleLabel}>Unread only</span>
      </div>

      <div className={styles.body}>
        <EmptyState
          size="panel"
          illustration={<AllCaughtUp />}
          title="You're all caught up!"
          body="No new notifications for now. Enjoy the calm."
        />
      </div>
    </aside>
  );
}
