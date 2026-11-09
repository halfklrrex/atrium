import { Button } from '@vibe/core';
import { useId, useMemo } from 'react';
import { useAuth } from '../../auth/auth-context';
import { showToast } from '../../components/toast-store';
import { UserAvatar } from '../../components/UserAvatar';
import { useMyUserDoc, userWrites } from '../../data/user-settings';
import styles from './Settings.module.css';
import { timeZoneChoices } from './time-zones';

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Settings > Profile: the Google identity (read-only) and the time zone. */
export function ProfileTab() {
  const { user } = useAuth();
  const uid = user?.uid;
  const { data: doc, loading } = useMyUserDoc(uid);
  const selectId = useId();
  const hintId = useId();
  const stored = doc?.timezone;
  const zones = useMemo(() => timeZoneChoices(stored), [stored]);

  const save = (timezone: string) => {
    if (!uid || timezone === stored) return;
    userWrites.setTimezone(uid, timezone).catch(() => {
      showToast("Couldn't save your time zone.", { type: 'negative' });
    });
  };

  const name = user?.displayName ?? user?.email ?? 'Account';
  const device = deviceTimeZone();

  return (
    <>
      <section className={styles.section} aria-labelledby="profile-title">
        <h2 id="profile-title" className={styles.sectionTitle}>
          Profile
        </h2>
        <div className={styles.profileCard}>
          <UserAvatar uid={uid ?? ''} name={name} photoURL={user?.photoURL ?? null} size="large" />
          <div className={styles.profileText}>
            <span className={styles.profileName}>{name}</span>
            <span className={styles.profileEmail}>{user?.email}</span>
          </div>
        </div>
        <p className={styles.hint}>From your Google account.</p>
      </section>

      <section className={styles.section} aria-labelledby="timezone-title">
        <h2 id="timezone-title" className={styles.sectionTitle}>
          Time zone
        </h2>
        <div className={styles.field}>
          <label htmlFor={selectId} className={styles.fieldLabel}>
            Your time zone
          </label>
          <select
            id={selectId}
            className={styles.select}
            aria-describedby={hintId}
            value={stored ?? ''}
            disabled={loading || !stored}
            onChange={(e) => save(e.target.value)}
          >
            {stored ? null : <option value="">Loading…</option>}
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p id={hintId} className={styles.hint}>
            Used for scheduled automations.
          </p>
          {stored && device && stored !== device ? (
            <Button
              kind="tertiary"
              size="small"
              className={styles.linkButton}
              onClick={() => save(device)}
            >
              Use this device&apos;s time zone ({device})
            </Button>
          ) : null}
        </div>
      </section>
    </>
  );
}
