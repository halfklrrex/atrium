import { useEffect } from 'react';
import { IconButton } from '@vibe/core';
import { NavigationChevronLeft } from '@vibe/icons';
import { Navigate, NavLink, useNavigate, useParams } from 'react-router';
import { useIsPhone } from '../../lib/use-media-query';
import { AccountTab } from './AccountTab';
import { AppearanceTab } from './AppearanceTab';
import { NotificationsTab } from './NotificationsTab';
import { PrivacyTab } from './PrivacyTab';
import { ProfileTab } from './ProfileTab';
import styles from './Settings.module.css';
import { SETTINGS_GROUPS, type SettingsTab, type SettingsTabInfo } from './settings-layout';

export type { SettingsTab } from './settings-layout';

const TABS: readonly SettingsTabInfo[] = SETTINGS_GROUPS.flatMap((group) => group.tabs);

const isTab = (value: string | undefined): value is SettingsTab =>
  TABS.some((tab) => tab.id === value);

function TabBody({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case 'profile':
      return <ProfileTab />;
    case 'appearance':
      return <AppearanceTab />;
    case 'notifications':
      return <NotificationsTab />;
    case 'account':
      return <AccountTab />;
    case 'privacy':
      return <PrivacyTab />;
  }
}

/** The tab's title and one hint line, above its cards. */
function SettingsTabHeader({ tab }: { tab: SettingsTabInfo }) {
  return (
    <header className={styles.tabHeader}>
      <h2 className={styles.tabTitle}>{tab.label}</h2>
      <p className={styles.tabHint}>{tab.hint}</p>
    </header>
  );
}

/** Phone header: Back to the index, then the tab's title (the page's h1) and hint. */
function SettingsPhoneHeader({ tab }: { tab: SettingsTabInfo }) {
  const navigate = useNavigate();
  return (
    <header className={styles.tabHeader}>
      <IconButton
        icon={NavigationChevronLeft}
        aria-label="Back to Settings"
        kind="tertiary"
        onClick={() => void navigate('/settings')}
      />
      <h1 className={styles.tabTitle}>{tab.label}</h1>
      <p className={styles.tabHint}>{tab.hint}</p>
    </header>
  );
}

/**
 * `/settings/:tab`: everything about "me", one URL per tab. An unknown tab lands on Profile, or on
 * the index on a phone, where the tab has no nav and a "Back to Settings" button instead.
 */
export function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const isPhone = useIsPhone();

  useEffect(() => {
    const previous = document.title;
    document.title = 'Settings · Atrium';
    return () => {
      document.title = previous;
    };
  }, []);

  if (!isTab(tab)) return <Navigate to={isPhone ? '/settings' : '/settings/profile'} replace />;
  const current = TABS.find((entry) => entry.id === tab)!;

  if (isPhone) {
    return (
      <div className={styles.phonePage}>
        <div className={styles.column}>
          <SettingsPhoneHeader tab={current} />
          <TabBody tab={tab} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.navPanel}>
        <h1 className={styles.heading}>Settings</h1>
        <nav className={styles.nav} aria-label="Settings sections">
          {SETTINGS_GROUPS.map((group) => {
            const labelId = `settings-group-${group.label.toLowerCase()}`;
            return (
              <div key={group.label} className={styles.navGroup}>
                <h2 id={labelId} className={styles.navGroupLabel}>
                  {group.label}
                </h2>
                <ul className={styles.navList} aria-labelledby={labelId}>
                  {group.tabs.map(({ id, label, icon: Icon }) => (
                    <li key={id}>
                      <NavLink
                        to={`/settings/${id}`}
                        className={({ isActive }) =>
                          isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
                        }
                      >
                        <Icon className={styles.navIcon} aria-hidden />
                        {label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>
      <div className={styles.body}>
        <div className={styles.column}>
          <SettingsTabHeader tab={current} />
          <TabBody tab={tab} />
        </div>
      </div>
    </div>
  );
}
