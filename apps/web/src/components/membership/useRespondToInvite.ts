import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { describeCallableError, membershipCalls } from '../../lib/callables';
import { showToast } from '../toast-store';
import { useInvitesStore } from './invites-store';

export interface InviteRef {
  workspaceId: string;
  inviteId: string;
  workspaceName: string;
}

/** Accept or decline an invitation: calls the function, updates the list, switches workspace. */
export function useRespondToInvite() {
  const navigate = useNavigate();
  const { rememberWorkspace } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept(invite: InviteRef): Promise<boolean> {
    setBusyId(invite.inviteId);
    setError(null);
    try {
      const { workspaceId } = await membershipCalls.acceptInvite({
        workspaceId: invite.workspaceId,
        inviteId: invite.inviteId,
      });
      useInvitesStore.getState().remove(invite.workspaceId, invite.inviteId);
      rememberWorkspace(workspaceId);
      showToast(`You joined ${invite.workspaceName}.`, { type: 'positive' });
      void navigate(`/workspaces/${workspaceId}`);
      return true;
    } catch (e) {
      console.error('Could not accept the invitation', e);
      setError(describeCallableError(e, 'Could not accept the invitation.'));
      setBusyId(null);
      return false;
    }
  }

  async function decline(invite: InviteRef): Promise<boolean> {
    setBusyId(invite.inviteId);
    setError(null);
    try {
      await membershipCalls.declineInvite({
        workspaceId: invite.workspaceId,
        inviteId: invite.inviteId,
      });
      useInvitesStore.getState().remove(invite.workspaceId, invite.inviteId);
      showToast('Invitation declined.');
      setBusyId(null);
      return true;
    } catch (e) {
      console.error('Could not decline the invitation', e);
      setError(describeCallableError(e, 'Could not decline the invitation.'));
      setBusyId(null);
      return false;
    }
  }

  return { accept, decline, busyId, error };
}
