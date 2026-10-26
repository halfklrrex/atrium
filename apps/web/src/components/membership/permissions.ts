import { assignableRoles, canRemoveMember, type WorkspaceRole } from '@atrium/shared';

export interface MemberRowActions {
  /** Roles the actor can pick for this member, current role first. Empty means a read-only label. */
  roleChoices: WorkspaceRole[];
  canTransfer: boolean;
  canRemove: boolean;
  canLeave: boolean;
}

/** What the signed-in user may do to one row of the Members tab (mirrors the callables). */
export function memberRowActions(
  actorRole: WorkspaceRole | null | undefined,
  rowRole: WorkspaceRole,
  isSelf: boolean,
): MemberRowActions {
  const assignable = assignableRoles(actorRole, rowRole, isSelf);
  // Ownership moves through "Transfer ownership", never through the role dropdown.
  const choices = assignable.filter((r) => r !== 'owner');
  return {
    roleChoices: choices.length > 0 ? [rowRole, ...choices] : [],
    canTransfer: assignable.includes('owner'),
    canRemove: canRemoveMember(actorRole, rowRole, isSelf),
    canLeave: isSelf && rowRole !== 'owner',
  };
}
