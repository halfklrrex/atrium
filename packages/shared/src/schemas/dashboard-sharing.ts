import { z } from 'zod';
import { boardKindSchema, boardRoleSchema } from '../roles';

/** Callable name, shared so client and server cannot drift. */
export const SET_DASHBOARD_ACCESS_CALLABLE = 'setDashboardAccess';

/**
 * One sharing change on a dashboard (dashboard owners only): a new `kind`, and/or one person's
 * role (`role: null` removes them). At least one of the two. The result is the same shape the
 * board sharing callables return (the dashboard's resulting kind and explicit access map).
 */
export const setDashboardAccessRequestSchema = z
  .object({
    dashboardId: z.string().min(1).max(64),
    kind: boardKindSchema.optional(),
    person: z
      .object({ uid: z.string().min(1).max(128), role: boardRoleSchema.nullable() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((r) => r.kind !== undefined || r.person !== undefined, {
    message: 'Nothing to change.',
  });
export type SetDashboardAccessRequest = z.infer<typeof setDashboardAccessRequestSchema>;

/** Callable name for doc sharing. */
export const SET_DOC_ACCESS_CALLABLE = 'setDocAccess';

/** One sharing change on a doc (doc owners only); same shape and result as the dashboard one. */
export const setDocAccessRequestSchema = z
  .object({
    docId: z.string().min(1).max(64),
    kind: boardKindSchema.optional(),
    person: z
      .object({ uid: z.string().min(1).max(128), role: boardRoleSchema.nullable() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((r) => r.kind !== undefined || r.person !== undefined, {
    message: 'Nothing to change.',
  });
export type SetDocAccessRequest = z.infer<typeof setDocAccessRequestSchema>;
