import { z } from 'zod';
import { accountStatusSchema } from './account';
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

/**
 * `workspaceId` is absent only while the account waits for approval (ADMIN-2, behind the functions
 * environment variable `ACCOUNT_APPROVAL_REQUIRED`). `accountStatus` is sent only when that variable is on.
 */
export const bootstrapUserResultSchema = z.object({
  workspaceId: idSchema.optional(),
  accountStatus: accountStatusSchema.optional(),
});
export type BootstrapUserResult = z.infer<typeof bootstrapUserResultSchema>;
