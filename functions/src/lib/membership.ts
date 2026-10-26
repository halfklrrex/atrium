import {
  INVITE_TTL_MS,
  MAX_PENDING_INVITES,
  assignableRoles,
  canRemoveMember,
  invitableRoles,
  normalizeEmail,
  type AcceptInviteRequest,
  type AcceptInviteResult,
  type ChangeMemberRoleRequest,
  type CreateInviteResult,
  type DeclineInviteRequest,
  type GetInviteStatusRequest,
  type GetInviteStatusResult,
  type InviteRole,
  type InviteStatus,
  type ListMyInvitesResult,
  type RemoveMemberRequest,
  type RevokeInviteRequest,
  type WorkspaceRole,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';

/** Verified identity of the caller, taken from the Auth token (never from client data). */
export interface Actor {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoURL: string | null;
}

export interface MemberProfile {
  displayName: string;
  photoURL: string | null;
  email: string;
}

export interface WorkspaceData {
  name: string;
  ownerId: string;
  memberIds: string[];
  roles: Record<string, WorkspaceRole>;
}

export interface InviteData {
  email: string;
  role: InviteRole;
  invitedBy: string;
  invitedByName: string;
  workspaceName: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: InviteStatus;
}

/** Validated input of `createInvite` (the email is already lowercased by the schema). */
export interface CreateInviteInput {
  workspaceId: string;
  email: string;
  role: InviteRole;
}

/**
 * The slice of a Firestore transaction the membership callables need, so the rules of who may do what
 * can be unit tested with an in-memory fake. Contract: every read happens before the first write, and
 * every write that changes `roles` also changes `memberIds` and the member docs in the same transaction.
 */
export interface MembershipTx {
  getWorkspace(workspaceId: string): Promise<WorkspaceData | null>;
  getInvite(workspaceId: string, inviteId: string): Promise<InviteData | null>;
  listPendingInvites(workspaceId: string): Promise<Array<{ id: string; data: InviteData }>>;
  listMembers(workspaceId: string): Promise<Array<{ uid: string; email: string }>>;
  newInviteId(workspaceId: string): string;
  createInvite(workspaceId: string, inviteId: string, data: InviteData): void;
  updateInvite(workspaceId: string, inviteId: string, patch: Partial<InviteData>): void;
  /** Adds the uid to `roles` and `memberIds` and creates its member doc. */
  addMember(workspaceId: string, uid: string, role: WorkspaceRole, profile: MemberProfile): void;
  /** Makes sure a member doc exists with this profile (heals workspaces created in the browser). */
  ensureMemberDoc(
    workspaceId: string,
    uid: string,
    role: WorkspaceRole,
    profile: MemberProfile,
  ): void;
  /** Updates `roles[uid]` and the member doc's `role` copy. */
  setMemberRole(workspaceId: string, uid: string, role: WorkspaceRole): void;
  /** `newOwner` becomes owner and `ownerId`; `oldOwner` becomes admin. */
  transferOwnership(workspaceId: string, newOwner: string, oldOwner: string): void;
  /** Removes the uid from `roles` and `memberIds` and deletes its member doc. */
  removeMember(workspaceId: string, uid: string): void;
}

const denied = (message: string, reason?: string) =>
  new HttpsError('permission-denied', message, reason ? { reason } : undefined);

function actorProfile(actor: Actor): MemberProfile {
  return {
    displayName: actor.displayName ?? actor.email ?? '',
    photoURL: actor.photoURL,
    email: actor.email ? normalizeEmail(actor.email) : '',
  };
}

async function loadWorkspace(tx: MembershipTx, workspaceId: string): Promise<WorkspaceData> {
  const ws = await tx.getWorkspace(workspaceId);
  if (!ws) throw new HttpsError('not-found', 'Workspace not found.');
  return ws;
}

function requireAdmin(ws: WorkspaceData, uid: string): WorkspaceRole {
  const role = ws.roles[uid];
  if (role !== 'owner' && role !== 'admin') {
    throw denied('Only workspace owners and admins can do that.');
  }
  return role;
}

/** The invitee's verified email, or a permission error. */
function requireVerifiedEmail(actor: Actor): string {
  if (!actor.email || !actor.emailVerified) {
    throw denied('Your Google account email must be verified.', 'unverified_email');
  }
  return normalizeEmail(actor.email);
}

const isExpired = (invite: InviteData, nowMs: number) => invite.expiresAtMs <= nowMs;

export async function createInviteInTransaction(
  tx: MembershipTx,
  actor: Actor,
  req: CreateInviteInput,
  nowMs: number,
  baseUrl: string,
): Promise<CreateInviteResult> {
  const ws = await loadWorkspace(tx, req.workspaceId);
  const actorRole = requireAdmin(ws, actor.uid);
  if (!invitableRoles(actorRole).includes(req.role)) {
    throw denied('Only the workspace owner can invite admins.');
  }
  const email = normalizeEmail(req.email);
  const [members, pending] = await Promise.all([
    tx.listMembers(req.workspaceId),
    tx.listPendingInvites(req.workspaceId),
  ]);
  if (members.some((m) => normalizeEmail(m.email) === email)) {
    throw new HttpsError('already-exists', 'That person is already a member of this workspace.', {
      reason: 'already_member',
    });
  }
  const existing = pending.find((p) => p.data.email === email);
  const live = pending.filter((p) => !isExpired(p.data, nowMs));
  if (!existing && live.length >= MAX_PENDING_INVITES) {
    throw new HttpsError(
      'resource-exhausted',
      `A workspace can have at most ${MAX_PENDING_INVITES} pending invites.`,
    );
  }

  if (!members.some((m) => m.uid === actor.uid)) {
    tx.ensureMemberDoc(req.workspaceId, actor.uid, actorRole, actorProfile(actor));
  }

  const invitedByName = actor.displayName ?? actor.email ?? '';
  const expiresAtMs = nowMs + INVITE_TTL_MS;
  let inviteId: string;
  if (existing) {
    inviteId = existing.id;
    // Re-inviting refreshes the role and the expiry.
    tx.updateInvite(req.workspaceId, inviteId, {
      role: req.role,
      invitedBy: actor.uid,
      invitedByName,
      workspaceName: ws.name,
      expiresAtMs,
      status: 'pending',
    });
  } else {
    inviteId = tx.newInviteId(req.workspaceId);
    tx.createInvite(req.workspaceId, inviteId, {
      email,
      role: req.role,
      invitedBy: actor.uid,
      invitedByName,
      workspaceName: ws.name,
      createdAtMs: nowMs,
      expiresAtMs,
      status: 'pending',
    });
  }
  return {
    inviteId,
    inviteUrl: `${baseUrl}/invite/${encodeURIComponent(req.workspaceId)}/${encodeURIComponent(inviteId)}`,
  };
}

export async function revokeInviteInTransaction(
  tx: MembershipTx,
  actor: Actor,
  req: RevokeInviteRequest,
): Promise<void> {
  const ws = await loadWorkspace(tx, req.workspaceId);
  const actorRole = requireAdmin(ws, actor.uid);
  const invite = await tx.getInvite(req.workspaceId, req.inviteId);
  if (!invite) throw new HttpsError('not-found', 'Invite not found.');
  if (invite.role === 'admin' && actorRole !== 'owner') {
    throw denied('Only the workspace owner can revoke an admin invite.');
  }
  if (invite.status === 'revoked') return;
  if (invite.status !== 'pending') {
    throw new HttpsError('failed-precondition', `This invite was already ${invite.status}.`);
  }
  tx.updateInvite(req.workspaceId, req.inviteId, { status: 'revoked' });
}

export async function acceptInviteInTransaction(
  tx: MembershipTx,
  actor: Actor,
  req: AcceptInviteRequest,
  nowMs: number,
): Promise<AcceptInviteResult> {
  const email = requireVerifiedEmail(actor);
  const ws = await loadWorkspace(tx, req.workspaceId);
  const invite = await tx.getInvite(req.workspaceId, req.inviteId);
  if (!invite) throw new HttpsError('not-found', 'Invite not found.');
  if (invite.email !== email) {
    throw denied('This invite was sent to another email address.', 'wrong_email');
  }

  const existingRole = ws.roles[actor.uid];
  if (existingRole) {
    // Idempotent: already a member (a retry, or accepted from another tab).
    if (invite.status === 'pending') {
      tx.updateInvite(req.workspaceId, req.inviteId, { status: 'accepted' });
    }
    return { workspaceId: req.workspaceId, role: existingRole };
  }

  if (invite.status !== 'pending') {
    throw new HttpsError('failed-precondition', `This invite was ${invite.status}.`, {
      reason: invite.status,
    });
  }
  if (isExpired(invite, nowMs)) {
    throw new HttpsError('failed-precondition', 'This invite has expired.', { reason: 'expired' });
  }

  tx.addMember(req.workspaceId, actor.uid, invite.role, actorProfile(actor));
  tx.updateInvite(req.workspaceId, req.inviteId, { status: 'accepted' });
  return { workspaceId: req.workspaceId, role: invite.role };
}

export async function declineInviteInTransaction(
  tx: MembershipTx,
  actor: Actor,
  req: DeclineInviteRequest,
): Promise<void> {
  const email = requireVerifiedEmail(actor);
  const invite = await tx.getInvite(req.workspaceId, req.inviteId);
  if (!invite) throw new HttpsError('not-found', 'Invite not found.');
  if (invite.email !== email) {
    throw denied('This invite was sent to another email address.', 'wrong_email');
  }
  if (invite.status === 'declined') return;
  if (invite.status !== 'pending') {
    throw new HttpsError('failed-precondition', `This invite was already ${invite.status}.`);
  }
  tx.updateInvite(req.workspaceId, req.inviteId, { status: 'declined' });
}

export async function changeMemberRoleInTransaction(
  tx: MembershipTx,
  actor: Actor,
  req: ChangeMemberRoleRequest,
): Promise<void> {
  const ws = await loadWorkspace(tx, req.workspaceId);
  const actorRole = requireAdmin(ws, actor.uid);
  const targetRole = ws.roles[req.uid];
  if (!targetRole) throw new HttpsError('not-found', 'That person is not a member.');
  const isSelf = req.uid === actor.uid;
  if (isSelf) {
    throw denied(
      actorRole === 'owner'
        ? 'The owner cannot change their own role. Transfer ownership to someone else instead.'
        : 'You cannot change your own role.',
    );
  }
  if (req.role === targetRole) return; // idempotent
  if (!assignableRoles(actorRole, targetRole, isSelf).includes(req.role)) {
    throw denied(
      req.role === 'owner'
        ? 'Only the owner can transfer ownership.'
        : 'You do not have permission to change that role.',
    );
  }
  if (req.role === 'owner') {
    tx.transferOwnership(req.workspaceId, req.uid, actor.uid);
  } else {
    tx.setMemberRole(req.workspaceId, req.uid, req.role);
  }
}

/** Removes `targetUid` on behalf of `actor` (the actor itself, for leaving). */
async function removeInTransaction(
  tx: MembershipTx,
  actor: Actor,
  workspaceId: string,
  targetUid: string,
): Promise<void> {
  const ws = await loadWorkspace(tx, workspaceId);
  const actorRole = ws.roles[actor.uid];
  const targetRole = ws.roles[targetUid];
  if (!actorRole) throw denied('You are not a member of this workspace.');
  if (!targetRole) throw new HttpsError('not-found', 'That person is not a member.');
  const isSelf = targetUid === actor.uid;
  if (!isSelf && actorRole !== 'owner' && actorRole !== 'admin') {
    throw denied('You do not have permission to remove that person.');
  }
  if (targetRole === 'owner') {
    throw new HttpsError(
      'failed-precondition',
      'The workspace owner cannot be removed. Transfer ownership first.',
      { reason: 'owner' },
    );
  }
  if (!isSelf && !canRemoveMember(actorRole, targetRole, false)) {
    throw denied('You do not have permission to remove that person.');
  }
  tx.removeMember(workspaceId, targetUid);
}

export const removeMemberInTransaction = (
  tx: MembershipTx,
  actor: Actor,
  req: RemoveMemberRequest,
) => removeInTransaction(tx, actor, req.workspaceId, req.uid);

export const leaveWorkspaceInTransaction = (tx: MembershipTx, actor: Actor, workspaceId: string) =>
  removeInTransaction(tx, actor, workspaceId, actor.uid);

// ---------------------------------------------------------------------------------------------
// Reads outside a transaction
// ---------------------------------------------------------------------------------------------

export interface InviteReader {
  /** Collection-group query: invites with this lowercased email and status `pending`. */
  findPendingInvitesByEmail(
    email: string,
  ): Promise<Array<{ workspaceId: string; id: string; data: InviteData }>>;
  getInvite(workspaceId: string, inviteId: string): Promise<InviteData | null>;
}

export async function listMyInvites(
  reader: InviteReader,
  actor: Actor,
  nowMs: number,
): Promise<ListMyInvitesResult> {
  if (!actor.email || !actor.emailVerified) return { invites: [] };
  const found = await reader.findPendingInvitesByEmail(normalizeEmail(actor.email));
  return {
    invites: found
      .filter((f) => !isExpired(f.data, nowMs))
      .map((f) => ({
        workspaceId: f.workspaceId,
        inviteId: f.id,
        workspaceName: f.data.workspaceName,
        role: f.data.role,
        invitedBy: f.data.invitedBy,
        invitedByName: f.data.invitedByName,
        expiresAt: f.data.expiresAtMs,
      })),
  };
}

/** What the invite page needs to explain an unusable link, without leaking the invitee. */
export async function getInviteStatus(
  reader: InviteReader,
  actor: Actor,
  req: GetInviteStatusRequest,
  nowMs: number,
): Promise<GetInviteStatusResult> {
  const invite = await reader.getInvite(req.workspaceId, req.inviteId);
  if (!invite) return { state: 'not_found' };
  if (!actor.email || !actor.emailVerified || normalizeEmail(actor.email) !== invite.email) {
    return { state: 'wrong_email' };
  }
  if (invite.status === 'pending' && isExpired(invite, nowMs)) return { state: 'expired' };
  return {
    state: invite.status,
    workspaceName: invite.workspaceName,
    invitedByName: invite.invitedByName,
    role: invite.role,
  };
}

// ---------------------------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------------------------

export interface BoardAccessStore {
  /** Ids of boards in the workspace whose `accessUids` contain the uid. */
  listBoardIdsWithAccess(workspaceId: string, uid: string): Promise<string[]>;
  /** Removes the uid from `access` and `accessUids` on these boards (one batch). */
  removeAccess(boardIds: string[], uid: string): Promise<void>;
}

const BATCH_SIZE = 400;

/**
 * Strips a removed member's stale board access. Rules already deny them through `isWsMember`, so
 * this is housekeeping: failures are logged and never thrown.
 */
export async function cleanupBoardAccess(
  store: BoardAccessStore,
  workspaceId: string,
  uid: string,
  log: (message: string, error: unknown) => void = () => undefined,
): Promise<number> {
  let cleaned = 0;
  try {
    const ids = await store.listBoardIdsWithAccess(workspaceId, uid);
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      try {
        await store.removeAccess(chunk, uid);
        cleaned += chunk.length;
      } catch (error) {
        log(`Board access cleanup failed for ${workspaceId}/${uid}`, error);
      }
    }
  } catch (error) {
    log(`Board access cleanup failed for ${workspaceId}/${uid}`, error);
  }
  return cleaned;
}

// ---------------------------------------------------------------------------------------------
// Member profile sync (bootstrapUser)
// ---------------------------------------------------------------------------------------------

export interface MemberProfileStore {
  /** Up to `limit` workspaces the user belongs to, with their role. */
  listMemberships(
    uid: string,
    limit: number,
  ): Promise<Array<{ workspaceId: string; role: WorkspaceRole }>>;
  getMemberProfile(workspaceId: string, uid: string): Promise<MemberProfile | null>;
  /** Updates the profile fields of the member doc, or creates it with `createWithRole` when given. */
  upsertMemberProfile(
    workspaceId: string,
    uid: string,
    profile: MemberProfile,
    createWithRole: WorkspaceRole | null,
  ): Promise<void>;
}

export const MEMBER_SYNC_LIMIT = 20;

/** Keeps the caller's member docs current (and creates missing ones). Returns how many were written. */
export async function syncMemberProfiles(store: MemberProfileStore, actor: Actor): Promise<number> {
  const profile = actorProfile(actor);
  const memberships = await store.listMemberships(actor.uid, MEMBER_SYNC_LIMIT);
  let written = 0;
  for (const m of memberships) {
    const current = await store.getMemberProfile(m.workspaceId, actor.uid);
    if (
      current &&
      current.displayName === profile.displayName &&
      current.photoURL === profile.photoURL &&
      current.email === profile.email
    ) {
      continue;
    }
    await store.upsertMemberProfile(m.workspaceId, actor.uid, profile, current ? null : m.role);
    written += 1;
  }
  return written;
}
