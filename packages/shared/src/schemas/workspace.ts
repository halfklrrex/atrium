import { z } from 'zod';
import { workspaceKindSchema, workspaceRoleSchema } from '../roles';
import {
  auditFields,
  hexColorSchema,
  iconSchema,
  idSchema,
  positionSchema,
  uidSchema,
  type WriteDoc,
} from './common';

/** `workspaces/{workspaceId}` (architecture §5.2). Invariant: `memberIds` equals `keys(roles)`. */
export const workspaceSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  icon: iconSchema,
  color: hexColorSchema,
  ownerId: uidSchema,
  memberIds: z.array(uidSchema).min(1),
  roles: z.record(uidSchema, workspaceRoleSchema),
  kind: workspaceKindSchema,
  ...auditFields,
});
export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspaceWrite = WriteDoc<Workspace>;

/** What the "New workspace" form collects. */
export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  icon: iconSchema,
  color: hexColorSchema,
  description: z.string().trim().max(500).default(''),
  kind: workspaceKindSchema.default('open'),
});
export type CreateWorkspaceInput = z.input<typeof createWorkspaceInputSchema>;

/** `workspaces/{workspaceId}/folders/{folderId}` (architecture §5.3). */
export const folderSchema = z.object({
  name: z.string().min(1).max(80),
  parentFolderId: idSchema.nullable(),
  color: hexColorSchema,
  position: positionSchema,
  ...auditFields,
});
export type Folder = z.infer<typeof folderSchema>;
export type FolderWrite = WriteDoc<Folder>;

/** Name for a user's personal workspace, e.g. "Ada's workspace". */
export function personalWorkspaceName(
  displayName: string | null | undefined,
  email?: string | null,
): string {
  const fromName = displayName?.trim().split(/\s+/)[0];
  const fromEmail = email?.split('@')[0]?.trim();
  const first = fromName || fromEmail;
  return first ? `${first}'s workspace` : 'My workspace';
}

/** What the folder dialog collects (create and edit). One level of nesting is supported by the UI. */
export const folderInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  color: hexColorSchema,
  parentFolderId: idSchema.nullable().default(null),
});
export type FolderInput = z.input<typeof folderInputSchema>;
