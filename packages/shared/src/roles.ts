import { z } from 'zod';

/** Roles a user can hold inside a workspace (architecture §5.2). */
export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

/** Roles a user can hold on a single board (architecture §5.4). */
export const BOARD_ROLES = ['owner', 'editor', 'viewer'] as const;
export const boardRoleSchema = z.enum(BOARD_ROLES);
export type BoardRole = z.infer<typeof boardRoleSchema>;

export const WORKSPACE_KINDS = ['open', 'closed'] as const;
export const workspaceKindSchema = z.enum(WORKSPACE_KINDS);
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>;

export const BOARD_KINDS = ['main', 'private', 'shareable'] as const;
export const boardKindSchema = z.enum(BOARD_KINDS);
export type BoardKind = z.infer<typeof boardKindSchema>;

export const ENTITY_STATES = ['active', 'archived', 'deleted'] as const;
export const entityStateSchema = z.enum(ENTITY_STATES);
export type EntityState = z.infer<typeof entityStateSchema>;

export const THEME_PREFERENCES = ['light', 'dark', 'black', 'system'] as const;
export const themePreferenceSchema = z.enum(THEME_PREFERENCES);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

/** Board role implied by a workspace role on a `main` board. Mirrors `mainBoardRole` in firestore.rules. */
export function boardRoleFromWorkspaceRole(
  role: WorkspaceRole | null | undefined,
): BoardRole | null {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'owner';
    case 'member':
      return 'editor';
    case 'viewer':
      return 'viewer';
    default:
      return null;
  }
}

const BOARD_ROLE_RANK: Record<BoardRole, number> = { viewer: 0, editor: 1, owner: 2 };

/**
 * The highest board role a workspace member may hold: `min(role implied by the workspace role,
 * requested)`. A workspace viewer never exceeds viewer, a member never exceeds editor. `null` when the
 * user is not a workspace member. The rules assume this cap holds for every explicit `access` entry.
 */
export function capBoardRole(
  workspaceRole: WorkspaceRole | null | undefined,
  requested: BoardRole,
): BoardRole | null {
  const ceiling = boardRoleFromWorkspaceRole(workspaceRole);
  if (!ceiling) return null;
  return BOARD_ROLE_RANK[requested] <= BOARD_ROLE_RANK[ceiling] ? requested : ceiling;
}

export interface BoardAccessInput {
  kind: BoardKind;
  access: Readonly<Record<string, BoardRole>>;
}

/**
 * Effective board role of `uid`: nothing counts unless the caller is still a member of the board's
 * workspace (so a removed member's stale `access` entry is dead). Then explicit access wins,
 * otherwise `main` boards derive the role from the workspace role.
 * Mirrors `boardRole` in firestore.rules.
 */
export function resolveBoardRole(
  board: BoardAccessInput,
  uid: string,
  workspaceRole: WorkspaceRole | null | undefined,
): BoardRole | null {
  if (!workspaceRole) return null;
  const explicit = board.access[uid];
  if (explicit) return explicit;
  return board.kind === 'main' ? boardRoleFromWorkspaceRole(workspaceRole) : null;
}

export const canEditBoard = (role: BoardRole | null): boolean =>
  role === 'owner' || role === 'editor';
export const canManageBoard = (role: BoardRole | null): boolean => role === 'owner';
export const canManageWorkspace = (role: WorkspaceRole | null | undefined): boolean =>
  role === 'owner' || role === 'admin';
