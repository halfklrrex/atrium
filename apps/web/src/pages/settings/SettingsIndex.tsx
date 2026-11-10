import { Button } from '@vibe/core';
import { NavigationChevronRight } from '@vibe/icons';
import { useEffect } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { useIsPhone } from '../../lib/use-media-query';
import { THEME_OPTIONS, useThemeStore } from '../../theme/theme';
import { IdentityCard } from './IdentityCard';
import styles from './Settings.module.css';
import { SETTINGS_GROUPS } from './settings-layout';

/** The phone's Settings home: your card, the sections as rows, and Sign out. */
export function SettingsIndex() {
  const { signOut } = useAuth();
  const preference = useThemeStore((s) => s.preference);
  const themeLabel = THEME_OPTIONS.find((option) => option.value === preference)?.label;

  useEffect(() => {
    const previous = document.title;
    document.title = 'Settings · Atrium';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className={styles.indexPage}>
      <h1 className={styles.heading}>Settings</h1>
      <IdentityCard />
      {SETTINGS_GROUPS.map((group) => {
        const labelId = `settings-index-group-${group.label.toLowerCase()}`;
        return (
          <section key={group.label} className={styles.indexGroup}>
            <h2 id={labelId} className={styles.navGroupLabel}>
              {group.label}
            </h2>
            <ul className={`${styles.card} ${styles.indexList}`} aria-labelledby={labelId}>
              {group.tabs.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <Link to={`/settings/${id}`} className={styles.indexRow}>
                    <Icon className={styles.navIcon} aria-hidden />
                    <span className={styles.indexLabel}>{label}</span>
                    {id === 'appearance' && themeLabel ? (
                      <span className={styles.indexValue}>{themeLabel}</span>
                    ) : null}
                    <NavigationChevronRight className={styles.navIcon} aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <Button kind="secondary" size="large" onClick={() => void signOut()}>
        Sign out
      </Button>
    </div>
  );
}

/** `/settings`: the index on a phone, Profile everywhere else. */
export function SettingsIndexRoute() {
  const isPhone = useIsPhone();
  return isPhone ? <SettingsIndex /> : <Navigate to="/settings/profile" replace />;
}
