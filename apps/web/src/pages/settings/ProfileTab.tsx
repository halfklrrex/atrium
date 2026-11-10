import { Button } from '@vibe/core';
import { useId, useMemo } from 'react';
import { useAuth } from '../../auth/auth-context';
import { showToast } from '../../components/toast-store';
import { useMyUserDoc, userWrites } from '../../data/user-settings';
import { IdentityCard } from './IdentityCard';
import styles from './Settings.module.css';
import { SettingsCard } from './SettingsCard';
import { timeZoneChoices } from './time-zones';

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Settings > Profile: the Google identity (read-only), the time zone and the user ID. */
export function ProfileTab() {
  const { user } = useAuth();
  const uid = user?.uid;
  const { data: doc, loading } = useMyUserDoc(uid);
  const selectId = useId();
  const stored = doc?.timezone;
  const zones = useMemo(() => timeZoneChoices(stored), [stored]);

  const save = (timezone: string) => {
    if (!uid || timezone === stored) return;
    userWrites.setTimezone(uid, timezone).catch(() => {
      showToast("Couldn't save your time zone.", { type: 'negative' });
    });
  };

  const copyUid = () => {
    if (!uid) return;
    navigator.clipboard.writeText(uid).then(
      () => showToast('User ID copied.', { type: 'positive' }),
      () => showToast("Couldn't copy. Select the ID and copy it by hand.", { type: 'negative' }),
    );
  };

  const device = deviceTimeZone();

  return (
    <>
      <IdentityCard />

      <SettingsCard title="Time zone" hint="Used for scheduled automations.">
        <div className={styles.row}>
          <div className={styles.rowText}>
            <label htmlFor={selectId} className={styles.rowTitle}>
              Your time zone
            </label>
            {device ? <span className={styles.rowValue}>This device: {device}</span> : null}
          </div>
          <select
            id={selectId}
            className={styles.select}
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
        </div>
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
      </SettingsCard>

      <SettingsCard
        title="User ID"
        hint="Your account's unique ID. You need it to connect tools such as the Atrium MCP connector. It isn't secret on its own, but there's no reason to post it publicly."
      >
        <div className={styles.idRow}>
          <code className={styles.idValue} data-testid="user-id-value">
            {uid}
          </code>
          <Button kind="tertiary" size="small" onClick={copyUid}>
            Copy
          </Button>
        </div>
      </SettingsCard>
    </>
  );
}
