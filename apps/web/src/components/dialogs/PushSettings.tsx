import { DEFAULT_PUSH_PREFS, type NotificationPrefs, type PushPrefs } from '@atrium/shared';
import { Button, Toggle } from '@vibe/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  disablePush,
  enablePush,
  getPushState,
  type PushDeps,
  type PushDeviceState,
} from '../../lib/push';
import { pushDeps as realPushDeps } from '../../lib/push-runtime';
import { notificationWrites } from '../../data/notifications';
import { showToast } from '../toast-store';
import styles from './dialogs.module.css';

/** The seven push switches, in the order shown. */
export const PUSH_KINDS: readonly { kind: keyof PushPrefs; label: string; hint: string }[] = [
  { kind: 'assigned', label: 'Assigned to me', hint: 'Someone adds you to a People column.' },
  { kind: 'reply', label: 'Replies', hint: 'Someone replies to an update you wrote.' },
  { kind: 'mention', label: 'Mentions', hint: 'Someone mentions you in an update or reply.' },
  { kind: 'button', label: 'Button clicks', hint: 'Someone clicks a button that notifies you.' },
  { kind: 'automation', label: 'Automations', hint: 'An automation notifies you. Off by default.' },
  {
    kind: 'account',
    label: 'Account requests and approvals',
    hint: 'Someone asks to join, or your own request is approved.',
  },
  { kind: 'inbox', label: 'Inbox messages', hint: 'New Inbox messages and replies to yours.' },
];

const STATUS_TEXT: Record<Exclude<PushDeviceState, 'off' | 'on'>, string> = {
  unsupported: "This browser can't receive push notifications.",
  'ios-install':
    'To get push notifications on iPhone, install Atrium first: tap Share, then Add to Home Screen. Then open Atrium from your Home Screen and come back here.',
  'not-configured': 'Push notifications are not set up yet.',
  blocked:
    "Notifications are blocked for Atrium in this browser. Allow them in the browser's site settings (the icon next to the address), then reload this page.",
};

/** Loads the device state and exposes the two click handlers. */
export function usePushDevice(
  uid: string | undefined,
  ensureDefaultPrefs: () => Promise<void>,
  deps: PushDeps = realPushDeps,
) {
  const [state, setState] = useState<PushDeviceState | null>(null);
  const [busy, setBusy] = useState(false);
  const ensureRef = useRef(ensureDefaultPrefs);
  useEffect(() => {
    ensureRef.current = ensureDefaultPrefs;
  });

  const refresh = useCallback(async () => {
    setState(await getPushState(deps, uid).catch(() => 'unsupported' as const));
  }, [deps, uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (!uid) return;
    setBusy(true);
    try {
      const result = await enablePush(deps, uid, () => ensureRef.current());
      if (result === 'dismissed') showToast('Push notifications were not turned on.');
    } catch {
      showToast('Could not turn on push notifications on this device.', { type: 'negative' });
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [deps, refresh, uid]);

  const disable = useCallback(async () => {
    if (!uid) return;
    setBusy(true);
    try {
      await disablePush(deps, uid);
    } catch {
      showToast('Could not turn off push notifications on this device.', { type: 'negative' });
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [deps, refresh, uid]);

  return { state, busy, enable, disable };
}

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
