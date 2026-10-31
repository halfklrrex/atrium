import {
  BOARD_ROLES,
  boardRoleFromWorkspaceRole,
  capBoardRole,
  type BoardRole,
  type WorkspaceRole,
} from '@atrium/shared';
import type { BoardDoc, WorkspaceDoc } from '../../data';

export const BOARD_ROLE_LABEL: Record<BoardRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

/** "Invite / N": everyone on a main board's workspace, or the people listed on a private one. */
export function sharedCount(
  board: Pick<BoardDoc, 'kind' | 'accessUids'>,
  workspace: Pick<WorkspaceDoc, 'memberIds'> | null | undefined,
): number {
  if (board.kind === 'main') return workspace?.memberIds.length ?? board.accessUids.length;
  return board.accessUids.length;
}

/** Board roles a person with this workspace role may hold (the others are over their cap). */
export function allowedBoardRoles(workspaceRole: WorkspaceRole | null | undefined): BoardRole[] {
  return BOARD_ROLES.filter((role) => capBoardRole(workspaceRole, role) === role);
}

/** The role a newly added person gets: Editor, lowered to their workspace cap. */
export function defaultAddRole(workspaceRole: WorkspaceRole | null | undefined): BoardRole {
  return capBoardRole(workspaceRole, 'editor') ?? 'viewer';
}

/** Tooltip text for a role control that is capped, or null when nothing is capped. */
export function capExplanation(workspaceRole: WorkspaceRole | null | undefined): string | null {
  const ceiling = boardRoleFromWorkspaceRole(workspaceRole);
  if (ceiling === 'owner' || !ceiling) return null;
  return workspaceRole === 'viewer'
    ? 'Workspace viewers can only be viewers on a board.'
    : 'Workspace members can be editors at most on a board.';
}

/**
 * Workspace members who lose access when a `main` board becomes private or shareable: everyone who
 * relied on their workspace role (not listed on the board) except the caller, who is added as owner.
 */
export function membersLosingAccess(
  board: Pick<BoardDoc, 'kind' | 'access'>,
  workspace: Pick<WorkspaceDoc, 'memberIds'>,
  callerUid: string,
): number {
  if (board.kind !== 'main') return 0;
  return workspace.memberIds.filter((id) => id !== callerUid && !(id in board.access)).length;
}

/** True when removing or demoting `uid` would leave a private or shareable board without an owner. */
export function isLastExplicitOwner(
  board: Pick<BoardDoc, 'kind' | 'access'>,
  uid: string,
): boolean {
  if (board.kind === 'main' || board.access[uid] !== 'owner') return false;
  return Object.values(board.access).filter((role) => role === 'owner').length === 1;
}

/** "Leave board" is for explicit members of private and shareable boards. */
export function canLeaveBoard(board: Pick<BoardDoc, 'kind' | 'access'>, uid: string): boolean {
  return board.kind !== 'main' && uid in board.access;
}
