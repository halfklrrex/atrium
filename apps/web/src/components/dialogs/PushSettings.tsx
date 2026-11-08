import { DEFAULT_PUSH_PREFS, type NotificationPrefs, type PushPrefs } from '@atrium/shared';
import { Button, Toggle } from '@vibe/core';
import type { PushDeviceState } from '../../lib/push';
import { notificationWrites } from '../../data/notifications';
import { showToast } from '../toast-store';
import { PUSH_KINDS, STATUS_TEXT } from './push-device';
import styles from './dialogs.module.css';

/** "On this device": what this browser can do and the Enable / Disable button. */
export function DeviceSection({
  state,
  busy,
  onEnable,
  onDisable,
}: {
  state: PushDeviceState | null;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  return (
    <section className={styles.settingsSection} aria-labelledby="push-device-title">
      <h3 id="push-device-title" className={styles.sectionTitle}>
        On this device
      </h3>
      {state === null ? null : state === 'off' ? (
        <div className={styles.deviceRow}>
          <p className={styles.deviceText}>This device does not receive push notifications.</p>
          <Button kind="primary" size="small" disabled={busy} onClick={onEnable}>
            Enable
          </Button>
        </div>
      ) : state === 'on' ? (
        <div className={styles.deviceRow}>
          <p className={styles.deviceText}>This device receives push notifications.</p>
          <Button kind="secondary" size="small" disabled={busy} onClick={onDisable}>
            Disable
          </Button>
        </div>
      ) : (
        <p className={styles.deviceText}>{STATUS_TEXT[state]}</p>
      )}
    </section>
  );
}

/** "Push notifications": one switch per kind; each change writes the whole `push` map. */
export function PushSwitches({
  uid,
  prefs,
  loading,
}: {
  uid: string | undefined;
  prefs: NotificationPrefs;
  loading: boolean;
}) {
  const push = prefs.push ?? DEFAULT_PUSH_PREFS;
  const change = (kind: keyof PushPrefs, on: boolean) => {
    if (!uid) return;
    notificationWrites.setPrefs(uid, { ...prefs, push: { ...push, [kind]: on } }).catch(() => {
      showToast('Could not save your notification settings.', { type: 'negative' });
    });
  };
  return (
    <section className={styles.settingsSection} aria-labelledby="push-kinds-title">
      <h3 id="push-kinds-title" className={styles.sectionTitle}>
        Push notifications
      </h3>
      <p className={styles.deviceText}>Choose what is sent to your devices.</p>
      <ul className={styles.switches}>
        {PUSH_KINDS.map(({ kind, label, hint }) => (
          <li key={kind} className={styles.switchRow}>
            <span className={styles.switchText}>
              <span className={styles.switchLabel}>{label}</span>
              <span className={styles.switchHint}>{hint}</span>
            </span>
            <Toggle
              isSelected={push[kind]}
              disabled={loading}
              onChange={(on) => change(kind, on)}
              aria-label={`Push: ${label}`}
              areLabelsHidden
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
