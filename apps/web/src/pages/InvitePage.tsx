import type { GetInviteStatusResult, MyInvite } from '@atrium/shared';
import { Button, Loader } from '@vibe/core';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { explainInviteState } from '../components/membership/explain-invite';
import { InviteCard } from '../components/membership/InviteCard';
import { useRespondToInvite } from '../components/membership/useRespondToInvite';
import { describeCallableError, membershipCalls } from '../lib/callables';
import styles from './InvitePage.module.css';

type Outcome =
  | { kind: 'loading' }
  | { kind: 'invite'; invite: MyInvite }
  | { kind: 'status'; status: GetInviteStatusResult }
  | { kind: 'error'; message: string };

/** `/invite/:workspaceId/:inviteId` - accept or decline an invitation (sign-in is enforced above). */
export function InvitePage() {
  const { workspaceId = '', inviteId = '' } = useParams();
  const { signOut } = useAuth();
  const { accept, decline, busyId, error } = useRespondToInvite();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { invites } = await membershipCalls.listMyInvites({});
        const found = invites.find((i) => i.workspaceId === workspaceId && i.inviteId === inviteId);
        if (found) return { kind: 'invite', invite: found } satisfies Outcome;
        const status = await membershipCalls.getInviteStatus({ workspaceId, inviteId });
        return { kind: 'status', status } satisfies Outcome;
      } catch (e) {
        return {
          kind: 'error',
          message: describeCallableError(e, 'Could not load the invitation.'),
        } satisfies Outcome;
      }
    }
    void load().then((result) => {
      if (!cancelled) setOutcome(result);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, inviteId]);

  if (outcome.kind === 'loading') {
    return (
      <div className={styles.page} role="status" aria-label="Loading invitation">
        <Loader size="medium" />
      </div>
    );
  }

  if (outcome.kind === 'invite') {
    const { invite } = outcome;
    return (
      <div className={styles.page}>
        <div className={styles.panel}>
          <h1 className={styles.title}>You're invited</h1>
          <InviteCard
            invitedByName={invite.invitedByName}
            workspaceName={invite.workspaceName}
            role={invite.role}
            busy={busyId === invite.inviteId}
            onAccept={() => void accept(invite)}
            onDecline={() =>
              void decline(invite).then(
                (ok) =>
                  ok &&
                  setOutcome({
                    kind: 'status',
                    status: {
                      state: 'declined',
                      invitedByName: invite.invitedByName,
                      workspaceName: invite.workspaceName,
                    },
                  }),
              )
            }
          />
          {error ? (
            <p className={styles.text} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const explained =
    outcome.kind === 'status'
      ? explainInviteState(outcome.status)
      : { title: "We couldn't load the invitation", text: outcome.message };
  const state = outcome.kind === 'status' ? outcome.status.state : null;
  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <h1 className={styles.title}>{explained.title}</h1>
        <p className={styles.text}>{explained.text}</p>
        <div className={styles.actions}>
          {state === 'wrong_email' ? (
            <Button kind="primary" onClick={() => void signOut()}>
              Sign out
            </Button>
          ) : null}
          {state === 'accepted' ? (
            <Link to={`/workspaces/${workspaceId}`}>
              <Button kind="primary">Open workspace</Button>
            </Link>
          ) : null}
          <Link to="/">
            <Button kind="tertiary">Go to Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
