import { IconButton } from '@vibe/core';
import { Apps, Help, Inbox, Invite, Menu as MenuIcon, Notifications, Search } from '@vibe/icons';
import classNames from 'classnames';
import { Link } from 'react-router';
import { AtriumMark } from '../AtriumLogo';
import { showComingSoon } from '../toast-store';
import { useCurrentWorkspace } from './useCurrentWorkspace';
import { AppGridIcon } from './AppGridIcon';
import styles from './AppShell.module.css';
import { useUiStore } from './ui-store';
import { UserMenu } from './UserMenu';

/** Placeholder actions: they answer with a "coming soon" toast until their phase lands. */
const ACTIONS = [
  { label: 'Inbox', icon: Inbox, narrow: true },
  { label: 'Invite members', icon: Invite, narrow: false },
  { label: 'Apps', icon: Apps, narrow: false },
  { label: 'Search', icon: Search, narrow: true },
  { label: 'Help', icon: Help, narrow: false },
] as const;

/**
 * 48px bar straight on the app background: brand on the left; on the right 40px ghost buttons on a
 * 44px pitch, the app switcher with a little extra room before it, then the account avatar.
 */
export function TopBar() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const notificationsOpen = useUiStore((s) => s.notificationsOpen);
  const setNotificationsOpen = useUiStore((s) => s.setNotificationsOpen);
  const openDialog = useUiStore((s) => s.openDialog);
  const { workspace } = useCurrentWorkspace();
  const onAction = (label: string) => {
    if (label === 'Invite members' && workspace) {
      openDialog({ type: 'members', workspaceId: workspace.id, tab: 'invites' });
    } else {
      showComingSoon(label);
    }
  };

  return (
    <header className={styles.topBar}>
      <span className={styles.menuToggle}>
        <IconButton
          icon={MenuIcon}
          kind="tertiary"
          size="small"
          aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        />
      </span>
      <Link to="/" className={styles.brand} aria-label="Atrium workboards home">
        <AtriumMark size={24} />
        <span className={styles.brandName}>Atrium</span>
        <span className={styles.brandSuffix}>workboards</span>
      </Link>
      <div className={styles.topBarActions}>
        <span data-notifications-trigger="">
          <IconButton
            icon={Notifications}
            kind="tertiary"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            aria-controls="notifications-panel"
            active={notificationsOpen}
            onClick={() => setNotificationsOpen(!notificationsOpen)}
          />
        </span>
        {ACTIONS.map(({ label, icon, narrow }) => (
          <span key={label} className={classNames(!narrow && styles.hideNarrow)}>
            <IconButton
              icon={icon}
              kind="tertiary"
              aria-label={label}
              onClick={() => onAction(label)}
            />
          </span>
        ))}
        <span className={classNames(styles.appsButton, styles.hideNarrow)}>
          <IconButton
            icon={AppGridIcon}
            kind="tertiary"
            aria-label="App switcher"
            onClick={() => showComingSoon('App switcher')}
          />
        </span>
        <span className={styles.avatarSlot}>
          <UserMenu />
        </span>
      </div>
    </header>
  );
}
