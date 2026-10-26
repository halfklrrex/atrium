import type { InviteRole } from '@atrium/shared';
import { Button } from '@vibe/core';
import styles from './InviteCard.module.css';
import { ROLE_LABEL } from './roles';

/** "<inviter> invited you to <workspace> as <role>" with Accept and Decline. */
export function InviteCard({
  invitedByName,
  workspaceName,
  role,
  busy,
  onAccept,
  onDecline,
}: {
  invitedByName: string;
  workspaceName: string;
  role: InviteRole;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className={styles.card}>
      <p className={styles.text}>
        <span className={styles.strong}>{invitedByName || 'Someone'}</span> invited you to{' '}
        <span className={styles.strong}>{workspaceName}</span> as {ROLE_LABEL[role].toLowerCase()}.
      </p>
      <div className={styles.actions}>
        <Button kind="primary" size="small" disabled={busy} loading={busy} onClick={onAccept}>
          Accept
        </Button>
        <Button kind="tertiary" size="small" disabled={busy} onClick={onDecline}>
          Decline
        </Button>
      </div>
    </div>
  );
}
