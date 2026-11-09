import { useEffect } from 'react';
import { Navigate, NavLink, useParams } from 'react-router';
import { AccountTab } from './AccountTab';
import { AppearanceTab } from './AppearanceTab';
import { NotificationsTab } from './NotificationsTab';
import { PrivacyTab } from './PrivacyTab';
import { ProfileTab } from './ProfileTab';
import styles from './Settings.module.css';

export type SettingsTab = 'profile' | 'appearance' | 'notifications' | 'account' | 'privacy';

const TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'account', label: 'Account' },
  { id: 'privacy', label: 'Privacy and data' },
];

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

/** `/settings/:tab`: everything about "me", one URL per tab. An unknown tab lands on Profile. */
export function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();

  useEffect(() => {
    const previous = document.title;
    document.title = 'Settings · Atrium';
    return () => {
      document.title = previous;
    };
  }, []);

  if (!isTab(tab)) return <Navigate to="/settings/profile" replace />;

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Settings</h1>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Settings sections">
          <ul className={styles.navList}>
            {TABS.map(({ id, label }) => (
              <li key={id}>
                <NavLink
                  to={`/settings/${id}`}
                  className={({ isActive }) =>
                    isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
                  }
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.panel}>
          <TabBody tab={tab} />
        </div>
      </div>
    </div>
  );
}
