import styles from './InviteCard.module.css';
import { InviteCard } from './InviteCard';
import { useInvitesStore } from './invites-store';
import { useRespondToInvite } from './useRespondToInvite';

/** Home's "Pending invitations" card; renders nothing when there are none. */
export function PendingInvitations() {
  const invites = useInvitesStore((s) => s.invites);
  const { accept, decline, busyId, error } = useRespondToInvite();
  if (invites.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Pending invitations">
      <h2 className={styles.title}>Pending invitations</h2>
      {invites.map((invite) => (
        <InviteCard
          key={`${invite.workspaceId}/${invite.inviteId}`}
          invitedByName={invite.invitedByName}
          workspaceName={invite.workspaceName}
          role={invite.role}
          busy={busyId === invite.inviteId}
          onAccept={() => void accept(invite)}
          onDecline={() => void decline(invite)}
        />
      ))}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
