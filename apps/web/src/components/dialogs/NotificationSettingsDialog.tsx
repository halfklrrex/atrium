import type { NotificationKind } from '@atrium/shared';
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
import styles from './dialogs.module.css';

const KINDS: readonly { kind: NotificationKind; label: string; hint: string }[] = [
  { kind: 'assigned', label: 'Assigned to me', hint: 'Someone adds you to a People column.' },
  { kind: 'reply', label: 'Replies', hint: 'Someone replies to an update you wrote.' },
  { kind: 'mention', label: 'Mentions', hint: 'Someone mentions you in an update or reply.' },
];

/** "Notification settings": one switch per kind; each change is saved straight away. */
export function NotificationSettingsDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const { prefs, loading } = useNotificationPrefs(uid);

  const change = (kind: NotificationKind, on: boolean) => {
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
        </ModalContent>
      </ModalBasicLayout>
      <ModalFooter primaryButton={{ text: 'Done', onClick: onClose }} />
    </Modal>
  );
}
