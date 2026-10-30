import {
  Button,
  Dropdown,
  IconButton,
  Loader,
  Menu,
  MenuButton,
  MenuItem,
  Search,
  Tab,
  TabList,
} from '@vibe/core';
import { Check, CloseSmall, Settings } from '@vibe/icons';
import classNames from 'classnames';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import type { NotificationDoc } from '../../data/model';
import {
  notificationWrites,
  useNotifications,
  useUnreadNotifications,
} from '../../data/notifications';
import { EmptyState } from '../EmptyState/EmptyState';
import { AllCaughtUp } from '../illustrations';
import { itemViewPath } from '../item-view/item-view-store';
import { showToast } from '../toast-store';
import { NotificationCard } from './NotificationCard';
import {
  NOTIFICATION_TABS,
  TAB_LABELS,
  actorsOf,
  filterNotifications,
  type NotificationTab,
} from './notification-filter';
import styles from './NotificationsPanel.module.css';
import { useUiStore } from './ui-store';

/** Menus, dialogs and dropdown lists render outside the panel; pressing in them is not "outside". */
const FLOATING_LAYERS = '[role="menu"], [role="listbox"], [role="dialog"], [data-popup-keep]';

const EMPTY_COPY: Record<NotificationTab, { title: string; body: string }> = {
  all: { title: "You're all caught up!", body: 'No new notifications for now. Enjoy the calm.' },
  unread: { title: 'No unread notifications', body: "You've read everything. Nicely done." },
  mentioned: {
    title: 'No mentions yet',
    body: 'When someone mentions you in an update or a reply, it shows up here.',
  },
  assigned: {
    title: 'Nothing assigned to you',
    body: 'When someone adds you to an item, it shows up here.',
  },
};

type PersonOption = { value: string; label: string };

/**
 * Right-hand notifications panel, opened from the top bar's bell: the signed-in user's inbox with
 * monday's four tabs, search, a person filter and per-card read state.
 */
export function NotificationsPanel() {
  const open = useUiStore((s) => s.notificationsOpen);
  const setOpen = useUiStore((s) => s.setNotificationsOpen);
  const openDialog = useUiStore((s) => s.openDialog);
  const navigate = useNavigate();
  const { user } = useAuth();
  const uid = user?.uid;
  // Listen to the list only while the panel is open; the bell keeps its own cheap unread count.
  const list = useNotifications(open ? uid : undefined);
  const unread = useUnreadNotifications(uid);

  const [tab, setTab] = useState<NotificationTab>('all');
  const [term, setTerm] = useState('');
  const [actorId, setActorId] = useState<string | null>(null);
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
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A dialog or menu opened from the panel owns the key.
      if (useUiStore.getState().dialog) return;
      if (document.querySelector('[role="menu"]')) return;
      setOpen(false);
      returnTo?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel?.contains(target)) return;
      // The bell toggles the panel itself.
      if (trigger?.contains(target)) return;
      if (target instanceof Element && target.closest(FLOATING_LAYERS)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, setOpen]);

  const people = useMemo<PersonOption[]>(
    () => actorsOf(list.data).map((a) => ({ value: a.id, label: a.name })),
    [list.data],
  );
  const shown = useMemo(
    () => filterNotifications(list.data, { tab, term, actorId }),
    [list.data, tab, term, actorId],
  );
  const filtering = term.trim() !== '' || actorId !== null;

  const fail = (what: string) => () => showToast(`Could not ${what}.`, { type: 'negative' });
  const markRead = (n: NotificationDoc) => {
    if (uid) notificationWrites.markRead(uid, n.id).catch(fail('mark it as read'));
  };
  const markUnread = (n: NotificationDoc) => {
    if (uid) notificationWrites.markUnread(uid, n.id).catch(fail('mark it as unread'));
  };
  const remove = (n: NotificationDoc) => {
    if (uid) notificationWrites.remove(uid, n.id).catch(fail('delete the notification'));
  };
  const markAllRead = () => {
    if (!uid) return;
    const ids = [...list.data.filter((n) => n.readAt === null).map((n) => n.id), ...unread.ids];
    if (ids.length === 0) return;
    notificationWrites.markAllRead(uid, ids).catch(fail('mark everything as read'));
  };
  const openSettings = () => openDialog({ type: 'notificationSettings' });

  /** Marks the card read, then opens the item (a reply or mention opens its update). */
  const openNotification = (n: NotificationDoc) => {
    if (n.readAt === null) markRead(n);
    setOpen(false);
    void navigate(itemViewPath(n.boardId, n.itemId), {
      state: n.updateId ? { updateId: n.updateId, replyId: n.replyId } : undefined,
    });
  };

  const empty = filtering
    ? { title: 'No matching notifications', body: 'Try a different search or person.' }
    : EMPTY_COPY[tab];

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
            onClick={openSettings}
          />
          <MenuButton size="small" aria-label="More notification actions" closeMenuOnItemClick>
            <Menu id="notifications-menu" size="medium">
              <MenuItem title="Mark all as read" icon={Check} onClick={markAllRead} />
              <MenuItem title="Notification settings" icon={Settings} onClick={openSettings} />
            </Menu>
          </MenuButton>
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
        <TabList
          activeTabId={NOTIFICATION_TABS.indexOf(tab)}
          onTabChange={(index) => setTab(NOTIFICATION_TABS[index] ?? 'all')}
          size="sm"
        >
          {NOTIFICATION_TABS.map((id) => (
            <Tab key={id}>{TAB_LABELS[id]}</Tab>
          ))}
        </TabList>
      </div>

      <div className={styles.filters}>
        <div className={styles.search}>
          <Search
            value={term}
            onChange={setTerm}
            placeholder="Search all notifications"
            inputAriaLabel="Search notifications"
            size="small"
          />
        </div>
        <div className={styles.person}>
          <Dropdown
            size="small"
            placeholder="Filter by person"
            aria-label="Filter by person"
            options={people}
            value={people.find((p) => p.value === actorId)}
            clearable
            onChange={(selected: unknown) => {
              const option = selected as PersonOption | null;
              setActorId(option?.value ?? null);
            }}
            onClear={() => setActorId(null)}
          />
        </div>
      </div>

      <div className={styles.body}>
        {list.loading ? (
          <div className={styles.loading} role="status" aria-label="Loading notifications">
            <Loader size="medium" />
          </div>
        ) : list.error ? (
          <div className={styles.empty}>
            <EmptyState
              size="panel"
              title="Notifications are unavailable"
              body="We couldn't load your notifications. Try again in a moment."
            />
          </div>
        ) : shown.length === 0 ? (
          <div className={styles.empty}>
            <EmptyState
              size="panel"
              illustration={filtering ? undefined : <AllCaughtUp />}
              title={empty.title}
              body={empty.body}
            />
          </div>
        ) : (
          <ul className={styles.list} aria-label="Notifications list">
            {shown.map((n) => (
              <NotificationCard
                key={n.id}
                notification={n}
                term={term}
                onOpen={openNotification}
                onMarkRead={markRead}
                onMarkUnread={markUnread}
                onRemove={remove}
              />
            ))}
          </ul>
        )}
        {list.hasMore && !list.loading ? (
          <div className={styles.more}>
            <Button kind="tertiary" size="small" onClick={list.loadMore}>
              Load more
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
