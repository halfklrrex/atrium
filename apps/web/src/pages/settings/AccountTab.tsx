import { Button } from '@vibe/core';
import { useAuth } from '../../auth/auth-context';
import { useIsSiteAdmin } from '../../auth/useIsSiteAdmin';
import styles from './Settings.module.css';
import { SettingsCard } from './SettingsCard';

const PROVIDER_NAMES: Record<string, string> = { 'google.com': 'Google' };

/** Settings > Account: how you sign in, and sign out. */
export function AccountTab() {
  const { user, signOut } = useAuth();
  const isSiteAdmin = useIsSiteAdmin();
  const providers = (user?.providerData ?? []).map(
    (p) => PROVIDER_NAMES[p.providerId] ?? p.providerId,
  );

  return (
    <SettingsCard title="Account">
      <ul className={styles.rows}>
        <li className={styles.row}>
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>Signed in with</span>
            <span className={styles.rowValue}>
              {providers.length > 0 ? providers.join(', ') : 'Google'}
            </span>
          </span>
        </li>
        <li className={styles.row}>
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>Email</span>
            <span className={styles.rowValue}>{user?.email}</span>
          </span>
        </li>
        {isSiteAdmin ? (
          <li className={styles.row}>
            <span className={styles.rowValue}>You are a site admin.</span>
          </li>
        ) : null}
        <li className={styles.row}>
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>Sign out</span>
            <span className={styles.rowValue}>Also stops push notifications on this device.</span>
          </span>
          <Button kind="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </li>
      </ul>
    </SettingsCard>
  );
}
