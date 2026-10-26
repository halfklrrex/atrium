import { z } from 'zod';
import { workspaceRoleSchema, type WorkspaceRole } from '../roles';
import { idSchema, timestampSchema, uidSchema, type WriteDoc } from './common';

/** Roles an invite can grant. Ownership only changes through `changeMemberRole` (transfer). */
export const INVITE_ROLES = ['admin', 'member', 'viewer'] as const;
export const inviteRoleSchema = z.enum(INVITE_ROLES);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const INVITE_STATUSES = ['pending', 'accepted', 'declined', 'revoked'] as const;
export const inviteStatusSchema = z.enum(INVITE_STATUSES);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

/** Invites stay valid for this long (milliseconds). */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Canonical origin used to build invite links in callable results. */
export const APP_BASE_URL = 'https://atrium-workboards.web.app';
/** Pending invites allowed per workspace. */
export const MAX_PENDING_INVITES = 50;

/**
 * `workspaces/{workspaceId}/members/{uid}`: a denormalised copy of the profile fields every member of
 * the workspace may see. Written only by Cloud Functions. `role` is a display copy; the authoritative
 * role stays in `workspace.roles`.
 */
export const workspaceMemberSchema = z.object({
  displayName: z.string().max(200),
  photoURL: z.string().max(2048).nullable(),
  email: z.string().max(320),
  role: workspaceRoleSchema,
  joinedAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
export type WorkspaceMemberWrite = WriteDoc<WorkspaceMember>;

/** `workspaces/{workspaceId}/invites/{inviteId}`. Written only by Cloud Functions. */
export const workspaceInviteSchema = z.object({
  email: z.string().max(320),
  role: inviteRoleSchema,
  invitedBy: uidSchema,
  invitedByName: z.string().max(200),
  workspaceName: z.string().max(80),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  status: inviteStatusSchema,
});
export type WorkspaceInvite = z.infer<typeof workspaceInviteSchema>;
export type WorkspaceInviteWrite = WriteDoc<WorkspaceInvite>;

/** Normalised form of an email for invite matching. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const inviteEmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((value) => value.toLowerCase());

// ---------------------------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------------------------

export const CREATE_INVITE_CALLABLE = 'createInvite';
export const REVOKE_INVITE_CALLABLE = 'revokeInvite';
export const LIST_MY_INVITES_CALLABLE = 'listMyInvites';
export const ACCEPT_INVITE_CALLABLE = 'acceptInvite';
export const DECLINE_INVITE_CALLABLE = 'declineInvite';
export const CHANGE_MEMBER_ROLE_CALLABLE = 'changeMemberRole';
export const REMOVE_MEMBER_CALLABLE = 'removeMember';
export const LEAVE_WORKSPACE_CALLABLE = 'leaveWorkspace';

export const createInviteRequestSchema = z
  .object({ workspaceId: idSchema, email: inviteEmailSchema, role: inviteRoleSchema })
  .strict();
export type CreateInviteRequest = z.input<typeof createInviteRequestSchema>;

export const createInviteResultSchema = z
  .object({ inviteId: idSchema, inviteUrl: z.string().min(1) })
  .strict();
export type CreateInviteResult = z.infer<typeof createInviteResultSchema>;

export const revokeInviteRequestSchema = z
  .object({ workspaceId: idSchema, inviteId: idSchema })
  .strict();
export type RevokeInviteRequest = z.infer<typeof revokeInviteRequestSchema>;

export const okResultSchema = z.object({ ok: z.literal(true) }).strict();
export type OkResult = z.infer<typeof okResultSchema>;

export const listMyInvitesRequestSchema = z.object({}).strict();
export type ListMyInvitesRequest = z.infer<typeof listMyInvitesRequestSchema>;

export const myInviteSchema = z
  .object({
    workspaceId: idSchema,
    inviteId: idSchema,
    workspaceName: z.string(),
    role: inviteRoleSchema,
    invitedBy: uidSchema,
    invitedByName: z.string(),
    /** Milliseconds since the epoch. */
    expiresAt: z.number().int(),
  })
  .strict();
export type MyInvite = z.infer<typeof myInviteSchema>;

export const listMyInvitesResultSchema = z.object({ invites: z.array(myInviteSchema) }).strict();
export type ListMyInvitesResult = z.infer<typeof listMyInvitesResultSchema>;

export const acceptInviteRequestSchema = revokeInviteRequestSchema;
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;
export const acceptInviteResultSchema = z
  .object({ workspaceId: idSchema, role: workspaceRoleSchema })
  .strict();
export type AcceptInviteResult = z.infer<typeof acceptInviteResultSchema>;

export const GET_INVITE_STATUS_CALLABLE = 'getInviteStatus';

export const getInviteStatusRequestSchema = revokeInviteRequestSchema;
export type GetInviteStatusRequest = z.infer<typeof getInviteStatusRequestSchema>;

/** Why an invite link can or cannot be used by the signed-in caller (no invitee data is leaked). */
export const getInviteStatusResultSchema = z
  .object({
    state: z.enum([
      'pending',
      'accepted',
      'declined',
      'revoked',
      'expired',
      'wrong_email',
      'not_found',
    ]),
    workspaceName: z.string().optional(),
    invitedByName: z.string().optional(),
    role: inviteRoleSchema.optional(),
  })
  .strict();
export type GetInviteStatusResult = z.infer<typeof getInviteStatusResultSchema>;

export const declineInviteRequestSchema = revokeInviteRequestSchema;
export type DeclineInviteRequest = z.infer<typeof declineInviteRequestSchema>;

export const changeMemberRoleRequestSchema = z
  .object({ workspaceId: idSchema, uid: uidSchema, role: workspaceRoleSchema })
  .strict();
export type ChangeMemberRoleRequest = z.infer<typeof changeMemberRoleRequestSchema>;

export const removeMemberRequestSchema = z
  .object({ workspaceId: idSchema, uid: uidSchema })
  .strict();
export type RemoveMemberRequest = z.infer<typeof removeMemberRequestSchema>;

export const leaveWorkspaceRequestSchema = z.object({ workspaceId: idSchema }).strict();
export type LeaveWorkspaceRequest = z.infer<typeof leaveWorkspaceRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Permission matrix (shared so the dialog and the callables cannot drift)
// ---------------------------------------------------------------------------------------------

type WorkspaceRoleOrNull = WorkspaceRole | null | undefined;

/** Roles `actor` may grant through an invite. Only the owner invites admins. */
export function invitableRoles(actor: WorkspaceRoleOrNull): InviteRole[] {
  if (actor === 'owner') return ['admin', 'member', 'viewer'];
  if (actor === 'admin') return ['member', 'viewer'];
  return [];
}

/**
 * Roles `actor` may set on `target` (never includes `owner` unless the actor is the owner doing a
 * transfer). Empty when the actor may not touch that member at all.
 */
export function assignableRoles(
  actor: WorkspaceRoleOrNull,
  target: WorkspaceRoleOrNull,
  isSelf: boolean,
): WorkspaceRole[] {
  if (isSelf || !target) return [];
  if (actor === 'owner') {
    const all: WorkspaceRole[] = ['owner', 'admin', 'member', 'viewer'];
    return all.filter((r) => r !== target);
  }
  if (actor === 'admin' && (target === 'member' || target === 'viewer')) {
    return (['member', 'viewer'] as const).filter((r) => r !== target);
  }
  return [];
}

/** Whether `actor` may remove `target` (the owner can never be removed). */
export function canRemoveMember(
  actor: WorkspaceRoleOrNull,
  target: WorkspaceRoleOrNull,
  isSelf: boolean,
): boolean {
  if (isSelf || !target || target === 'owner') return false;
  if (actor === 'owner') return true;
  return actor === 'admin' && target !== 'admin';
}
