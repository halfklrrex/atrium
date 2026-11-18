import { z } from 'zod';
import { idSchema, timestampSchema } from './schemas/common';

/**
 * Personal access tokens (P8, docs/specs/P8-public-api-and-webhooks.md section 3): the scopes, the
 * callable request and result shapes, and the shape of `users/{uid}/apiTokens/{tokenId}` (written
 * only by Cloud Functions, self-read). The hash index `apiTokenIndex/{sha256hex}` is Functions-only.
 */

/** `read` covers every GET; `write` adds changes. Same meaning as the OPS4 connector scopes. */
export const API_TOKEN_SCOPES = ['read', 'write'] as const;
export const apiTokenScopeSchema = z.enum(API_TOKEN_SCOPES);
export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;

/** Every personal token starts with this; OAuth access tokens start with `atr_`. */
export const API_TOKEN_PREFIX = 'atrp_';
/** Characters of the token kept in the token document so a person can tell tokens apart. */
export const API_TOKEN_DISPLAY_PREFIX_LENGTH = 8;
/** Lifetimes a person can pick, in days. There is no "never expires". */
export const API_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;
export const API_TOKEN_DEFAULT_EXPIRY_DAYS = 90;
export const API_TOKEN_NAME_MAX = 60;
/** Active (not revoked, not expired) tokens one person may hold. */
export const API_TOKEN_MAX_ACTIVE = 10;
export const API_TOKEN_MAX_WORKSPACES = 50;

/** Callable names, shared so the web wrappers and the functions cannot drift. */
export const CREATE_API_TOKEN_CALLABLE = 'createApiToken';
export const REVOKE_API_TOKEN_CALLABLE = 'revokeApiToken';

export const apiTokenExpiryDaysSchema = z.union([z.literal(30), z.literal(90), z.literal(365)]);

export const createApiTokenRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(API_TOKEN_NAME_MAX),
    scopes: z
      .array(apiTokenScopeSchema)
      .min(1)
      .max(API_TOKEN_SCOPES.length)
      .refine((scopes) => new Set(scopes).size === scopes.length, 'Scopes must be unique.'),
    /** Restricts the token to these workspaces; omitted or empty means every workspace. */
    workspaceIds: z.array(idSchema).max(API_TOKEN_MAX_WORKSPACES).optional(),
    expiresInDays: apiTokenExpiryDaysSchema,
  })
  .strict();
export type CreateApiTokenRequest = z.infer<typeof createApiTokenRequestSchema>;

export const createApiTokenResultSchema = z.object({
  tokenId: idSchema,
  /** The full token. Shown once; only its hash is stored. */
  token: z.string().startsWith(API_TOKEN_PREFIX).max(128),
  prefix: z.string().max(API_TOKEN_DISPLAY_PREFIX_LENGTH),
  /** Epoch milliseconds. */
  expiresAt: z.number(),
});
export type CreateApiTokenResult = z.infer<typeof createApiTokenResultSchema>;

export const revokeApiTokenRequestSchema = z.object({ tokenId: idSchema }).strict();
export type RevokeApiTokenRequest = z.infer<typeof revokeApiTokenRequestSchema>;

export const revokeApiTokenResultSchema = z.object({
  tokenId: idSchema,
  /** False when the token was already revoked (a repeat is a no-op). */
  revoked: z.boolean(),
});
export type RevokeApiTokenResult = z.infer<typeof revokeApiTokenResultSchema>;

/** `users/{uid}/apiTokens/{tokenId}`: one personal access token. Clients never write it. */
export const apiTokenSchema = z.object({
  name: z.string().max(API_TOKEN_NAME_MAX),
  prefix: z.string().max(API_TOKEN_DISPLAY_PREFIX_LENGTH),
  scopes: z.array(apiTokenScopeSchema),
  /** `null` means no workspace restriction. */
  workspaceIds: z.array(idSchema).max(API_TOKEN_MAX_WORKSPACES).nullable(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  lastUsedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
});
export type ApiToken = z.infer<typeof apiTokenSchema>;
