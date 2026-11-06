import { z } from 'zod';
import { accountStatusSchema } from './account';
import { uidSchema } from './schemas/common';

/** Callable names of the site-admin screen (ADMIN-2), shared so client and server cannot drift. */
export const SET_ACCOUNT_STATUS_CALLABLE = 'setAccountStatus';
export const LIST_ACCOUNTS_CALLABLE = 'listAccounts';

/** The statuses an admin can set: approve (also unblock) or block. `pending` is never set by hand. */
export const settableAccountStatusSchema = z.enum(['approved', 'blocked']);
export type SettableAccountStatus = z.infer<typeof settableAccountStatusSchema>;

export const setAccountStatusRequestSchema = z
  .object({ uid: uidSchema, status: settableAccountStatusSchema })
  .strict();
export type SetAccountStatusRequest = z.infer<typeof setAccountStatusRequestSchema>;

/** `changed: false` means the account was already in that state (a no-op). */
export const setAccountStatusResultSchema = z
  .object({ uid: uidSchema, status: settableAccountStatusSchema, changed: z.boolean() })
  .strict();
export type SetAccountStatusResult = z.infer<typeof setAccountStatusResultSchema>;

export const LIST_ACCOUNTS_PAGE_SIZE = { default: 50, max: 100 } as const;

export const listAccountsRequestSchema = z
  .object({
    pageToken: z.string().min(1).max(4096).optional(),
    pageSize: z.number().int().min(1).max(LIST_ACCOUNTS_PAGE_SIZE.max).optional(),
  })
  .strict();
export type ListAccountsRequest = z.infer<typeof listAccountsRequestSchema>;

export const accountListItemSchema = z
  .object({
    uid: uidSchema,
    displayName: z.string().max(200).nullable(),
    email: z.string().max(320).nullable(),
    photoURL: z.string().max(2048).nullable(),
    status: accountStatusSchema,
    /** ISO 8601, or null when Auth has no value. */
    createdAt: z.string().nullable(),
    lastSignInAt: z.string().nullable(),
  })
  .strict();
export type AccountListItem = z.infer<typeof accountListItemSchema>;

export const listAccountsResultSchema = z
  .object({ accounts: z.array(accountListItemSchema), nextPageToken: z.string().nullable() })
  .strict();
export type ListAccountsResult = z.infer<typeof listAccountsResultSchema>;
