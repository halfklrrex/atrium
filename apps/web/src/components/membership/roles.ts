import type { WorkspaceRole } from '@atrium/shared';

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

/** The link an owner or admin sends to the invitee (the page itself checks the signed-in email). */
export function inviteLink(workspaceId: string, inviteId: string): string {
  return `${window.location.origin}/invite/${encodeURIComponent(workspaceId)}/${encodeURIComponent(inviteId)}`;
}

/** "Expires in 3 days" / "Expired" for a pending invite. */
export function describeExpiry(expiresAtMs: number, nowMs: number = Date.now()): string {
  const remaining = expiresAtMs - nowMs;
  if (remaining <= 0) return 'Expired';
  const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  return days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`;
}
