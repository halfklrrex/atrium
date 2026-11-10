import { DEFAULT_PUSH_PREFS, type NotificationPrefs, type PushPrefs } from '@atrium/shared';
import { Button, Label, Toggle } from '@vibe/core';
import { useAuth } from '../../auth/auth-context';
import { STATUS_TEXT, usePushDevice } from '../../components/dialogs/push-device';
import { showToast } from '../../components/toast-store';
import { notificationWrites, useNotificationPrefs } from '../../data/notifications';
import type { PushDeviceState } from '../../lib/push';
import { SettingsCard } from './SettingsCard';
import styles from './Settings.module.css';

/** The bell switches; the optional `push` map has its own switches. */
type BellKind = Exclude<keyof NotificationPrefs, 'push'>;

/** One row of the matrix, in the order shown. `inBell` is false for the kinds that always reach the bell. */
const NOTIFICATION_EVENTS: readonly {
  kind: keyof PushPrefs;
  label: string;
  hint: string;
  inBell: boolean;
}[] = [
  {
    kind: 'assigned',
    label: 'Assigned to me',
    hint: 'Someone adds you to a People column.',
    inBell: true,
  },
  {
    kind: 'reply',
    label: 'Replies',
    hint: 'Someone replies to an update you wrote.',
    inBell: true,
  },
  {
    kind: 'mention',
    label: 'Mentions',
    hint: 'Someone mentions you in an update or reply.',
    inBell: true,
  },
  {
    kind: 'button',
    label: 'Button clicks',
    hint: 'Someone clicks a button that notifies you.',
    inBell: true,
  },
  {
    kind: 'automation',
    label: 'Automations',
    hint: 'An automation notifies you, or one you created is turned off.',
    inBell: true,
  },
  {
    kind: 'account',
    label: 'Account requests and approvals',
    hint: 'Someone asks to join, or your own request is approved.',
    inBell: false,
  },
  {
    kind: 'inbox',
    label: 'Inbox messages',
    hint: 'New Inbox messages and replies to yours.',
    inBell: false,
  },
];

const CHIPS: Record<PushDeviceState, { text: string; color: 'positive' | 'negative' | 'dark' }> = {
  on: { text: 'This device: push on', color: 'positive' },
  off: { text: 'This device: push off', color: 'dark' },
  unsupported: { text: 'No push here', color: 'dark' },
  'ios-install': { text: 'Install first', color: 'dark' },
  'not-configured': { text: 'Push not set up', color: 'dark' },
  blocked: { text: 'Push blocked', color: 'negative' },
};

/**
 * Settings > Notifications: one matrix, a row per event with an "In the bell" and a "Push" switch,
 * and this device's push state (chip, Enable / Disable) in the card header. Each switch is saved
 * straight away. The push switches are account-wide, so device state never disables them.
 */
export function NotificationsTab() {
  const { user } = useAuth();
  const uid = user?.uid;
  const { prefs, loading } = useNotificationPrefs(uid);
  const push = prefs.push ?? DEFAULT_PUSH_PREFS;

  const device = usePushDevice(uid, async () => {
    // A freshly enabled device starts from the push defaults when the person has none yet.
    if (uid && !prefs.push)
      await notificationWrites.setPrefs(uid, { ...prefs, push: DEFAULT_PUSH_PREFS });
  });

  const save = (next: NotificationPrefs) => {
    if (!uid) return;
    notificationWrites.setPrefs(uid, next).catch(() => {
      showToast('Could not save your notification settings.', { type: 'negative' });
    });
  };
  const changeBell = (kind: BellKind, on: boolean) => save({ ...prefs, [kind]: on });
  const changePush = (kind: keyof PushPrefs, on: boolean) =>
    save({ ...prefs, push: { ...push, [kind]: on } });

  const chip = device.state === null ? null : CHIPS[device.state];
  const statusText =
    device.state === null || device.state === 'on' || device.state === 'off'
      ? null
      : STATUS_TEXT[device.state];

  const headerEnd = chip ? (
    <div className={styles.deviceControls}>
      <Label text={chip.text} color={chip.color} kind="line" size="small" />
      {device.state === 'off' ? (
        <Button
          kind="primary"
          size="small"
          disabled={device.busy}
          onClick={() => void device.enable()}
        >
          Enable
        </Button>
      ) : device.state === 'on' ? (
        <Button
          kind="tertiary"
          size="small"
          disabled={device.busy}
          onClick={() => void device.disable()}
        >
          Disable
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <SettingsCard
      title="What notifies you"
      hint={
        <>
          One row per event. Push goes to every device where you turned it on.
          {statusText ? <span className={styles.cardStatus}>{statusText}</span> : null}
        </>
      }
      headerEnd={headerEnd}
    >
      <table className={styles.matrix}>
        <caption className={styles.visuallyHidden}>Notification settings</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.matrixHead}>
              Event
            </th>
            <th scope="col" className={`${styles.matrixHead} ${styles.matrixSwitchCell}`}>
              In the bell
            </th>
            <th scope="col" className={`${styles.matrixHead} ${styles.matrixSwitchCell}`}>
              Push
            </th>
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_EVENTS.map(({ kind, label, hint, inBell }) => (
            <tr key={kind} className={styles.matrixRow}>
              <th scope="row" className={styles.matrixEvent}>
                <span className={styles.matrixEventText}>
                  <span className={styles.rowTitle}>{label}</span>
                  <span className={styles.matrixHint}>{hint}</span>
                </span>
              </th>
              <td className={styles.matrixSwitchCell}>
                {inBell ? (
                  <Toggle
                    isSelected={prefs[kind as BellKind]}
                    disabled={loading}
                    onChange={(on) => changeBell(kind as BellKind, on)}
                    aria-label={`In the bell: ${label}`}
                    areLabelsHidden
                  />
                ) : (
                  <span className={styles.matrixAlways}>Always</span>
                )}
              </td>
              <td className={styles.matrixSwitchCell}>
                <Toggle
                  isSelected={push[kind]}
                  disabled={loading}
                  onChange={(on) => changePush(kind, on)}
                  aria-label={`Push: ${label}`}
                  areLabelsHidden
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </SettingsCard>
  );
}
