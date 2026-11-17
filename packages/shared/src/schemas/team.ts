import { z } from 'zod';
import { hexColorSchema, timestampSchema, uidSchema, type WriteDoc } from './common';

/** Limits shared by the web form, the rules (`firestore.rules`, `match /teams`) and the tests. */
export const TEAM_LIMITS = { name: 60, members: 100, perWorkspace: 50 } as const;

const memberUidsSchema = z
  .array(uidSchema)
  .max(TEAM_LIMITS.members)
  .refine((uids) => new Set(uids).size === uids.length, 'Members must be unique');

/**
 * `workspaces/{workspaceId}/teams/{teamId}`. A team holds only current workspace members; owners and
 * admins write it, every member reads it. `perWorkspace` is a client-side limit (rules can't count).
 */
export const teamSchema = z.object({
  name: z.string().trim().min(1).max(TEAM_LIMITS.name),
  color: hexColorSchema,
  memberUids: memberUidsSchema,
  createdAt: timestampSchema,
  createdBy: uidSchema,
  updatedAt: timestampSchema,
  updatedBy: uidSchema,
});
export type Team = z.infer<typeof teamSchema>;
export type TeamWrite = WriteDoc<Team>;

/** What the team dialog collects (create and edit). */
export const teamInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(TEAM_LIMITS.name),
  color: hexColorSchema,
  memberUids: memberUidsSchema,
});
export type TeamInput = z.input<typeof teamInputSchema>;
