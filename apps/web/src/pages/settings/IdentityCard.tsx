import { useAuth } from '../../auth/auth-context';
import { UserAvatar } from '../../components/UserAvatar';
import styles from './Settings.module.css';
import { IDENTITY_AVATAR_SIZE } from './settings-layout';

/** Your Google identity, read-only: avatar, name, email and where it comes from. */
export function IdentityCard() {
  const { user } = useAuth();
  const name = user?.displayName ?? user?.email ?? 'Account';
  return (
    <section className={`${styles.card} ${styles.identityCard}`} aria-label="Your Google account">
      <UserAvatar
        uid={user?.uid ?? ''}
        name={name}
        photoURL={user?.photoURL ?? null}
        customSize={IDENTITY_AVATAR_SIZE}
      />
      <div className={styles.identityText}>
        <span className={styles.identityName}>{name}</span>
        <span className={styles.identityEmail}>{user?.email}</span>
        <span className={styles.identitySource}>From your Google account</span>
      </div>
    </section>
  );
}
