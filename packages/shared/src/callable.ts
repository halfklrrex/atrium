import { z } from 'zod';
import { idSchema } from './schemas/common';

/** Name of the P0 callable function, shared so client and server cannot drift. */
export const BOOTSTRAP_USER_CALLABLE = 'bootstrapUser';

/** Optional client hints; identity (name, email, photo) always comes from the verified auth token. */
export const bootstrapUserRequestSchema = z
  .object({
    timezone: z.string().min(1).max(64).optional(),
    locale: z.string().min(1).max(32).optional(),
  })
  .strict();
export type BootstrapUserRequest = z.infer<typeof bootstrapUserRequestSchema>;

export const bootstrapUserResultSchema = z.object({ workspaceId: idSchema });
export type BootstrapUserResult = z.infer<typeof bootstrapUserResultSchema>;
