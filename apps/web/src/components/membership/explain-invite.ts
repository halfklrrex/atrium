import type { GetInviteStatusResult } from '@atrium/shared';

/** What to tell the person about an invite they cannot accept. */
export function explainInviteState(status: GetInviteStatusResult): {
  title: string;
  text: string;
} {
  const who = status.invitedByName || 'the person who invited you';
  switch (status.state) {
    case 'wrong_email':
      return {
        title: "This invite isn't for this account",
        text: 'This invite was sent to another email address. Sign in with that Google account.',
      };
    case 'expired':
      return {
        title: 'This invitation has expired',
        text: `Ask ${who} to send you a new one.`,
      };
    case 'revoked':
      return {
        title: 'This invitation was withdrawn',
        text: `${who} revoked it. Ask for a new invitation if you still want to join.`,
      };
    case 'declined':
      return {
        title: 'You declined this invitation',
        text: `If you changed your mind, ask ${who} to invite you again.`,
      };
    case 'accepted':
      return {
        title: 'You already joined',
        text: `You accepted this invitation${status.workspaceName ? ` to ${status.workspaceName}` : ''}.`,
      };
    case 'not_found':
    case 'pending':
    default:
      return {
        title: "We couldn't find that invitation",
        text: 'The link may be incomplete or the invitation may have been removed.',
      };
  }
}
