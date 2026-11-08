import { DEFAULT_PUSH_PREFS, type NotificationPrefs } from '@atrium/shared';
import {
  Modal,
  ModalBasicLayout,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Toggle,
} from '@vibe/core';
import { useAuth } from '../../auth/auth-context';
import { notificationWrites, useNotificationPrefs } from '../../data/notifications';
import { showToast } from '../toast-store';
import { usePushDevice } from './push-device';
import { DeviceSection, PushSwitches } from './PushSettings';
import styles from './dialogs.module.css';

/** The bell switches; the optional `push` map has its own switches in `PushSettings`. */
type BellKind = Exclude<keyof NotificationPrefs, 'push'>;

const KINDS: readonly { kind: BellKind; label: string; hint: string }[] = [
  { kind: 'assigned', label: 'Assigned to me', hint: 'Someone adds you to a People column.' },
  { kind: 'reply', label: 'Replies', hint: 'Someone replies to an update you wrote.' },
  { kind: 'mention', label: 'Mentions', hint: 'Someone mentions you in an update or reply.' },
  { kind: 'button', label: 'Button clicks', hint: 'Someone clicks a button that notifies you.' },
  {
    kind: 'automation',
    label: 'Automations',
    hint: 'An automation notifies you, or one you created is turned off.',
  },
];

/**
 * "Notification settings": the bell switches, "On this device" (enable or disable web push here) and
 * the push switches. Each switch is saved straight away.
 */
export function NotificationSettingsDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const { prefs, loading } = useNotificationPrefs(uid);

  const device = usePushDevice(uid, async () => {
    // A freshly enabled device starts from the push defaults when the person has none yet.
    if (uid && !prefs.push)
      await notificationWrites.setPrefs(uid, { ...prefs, push: DEFAULT_PUSH_PREFS });
  });

  const change = (kind: BellKind, on: boolean) => {
    if (!uid) return;
    notificationWrites.setPrefs(uid, { ...prefs, [kind]: on }).catch(() => {
      showToast('Could not save your notification settings.', { type: 'negative' });
    });
  };

  return (
    <Modal id="notification-settings-dialog" show size="small" onClose={onClose}>
      <ModalBasicLayout>
        <ModalHeader title="Notification settings" />
        <ModalContent>
          <section
            className={`${styles.settingsSection} ${styles.settingsSectionFirst}`}
            aria-labelledby="bell-kinds-title"
          >
            <h3 id="bell-kinds-title" className={styles.sectionTitle}>
              In the bell
            </h3>
            <ul className={styles.switches}>
              {KINDS.map(({ kind, label, hint }) => (
                <li key={kind} className={styles.switchRow}>
                  <span className={styles.switchText}>
                    <span className={styles.switchLabel}>{label}</span>
                    <span className={styles.switchHint}>{hint}</span>
                  </span>
                  <Toggle
                    isSelected={prefs[kind]}
                    disabled={loading}
                    onChange={(on) => change(kind, on)}
                    aria-label={label}
                    areLabelsHidden
                  />
                </li>
              ))}
            </ul>
          </section>
          <DeviceSection
            state={device.state}
            busy={device.busy}
            onEnable={() => void device.enable()}
            onDisable={() => void device.disable()}
          />
          <PushSwitches uid={uid} prefs={prefs} loading={loading} />
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter primaryButton={{ text: 'Done', onClick: onClose }} />
    </Modal>
  );
}
