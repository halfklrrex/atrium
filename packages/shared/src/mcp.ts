import { z } from 'zod';
import { idSchema, timestampSchema } from './schemas/common';

/**
 * Hosted MCP connector (OPS4, docs/specs/OPS4-hosted-mcp-connector.md): the scopes a connection can
 * hold, the callable request and result shapes of the consent page and the Connected apps card, and
 * the shape of `users/{uid}/mcpGrants/{grantId}` (written only by Cloud Functions, self-read).
 */

/** `atrium:read` is always granted; `atrium:write` is chosen on the consent screen (decision D5). */
export const MCP_SCOPES = ['atrium:read', 'atrium:write'] as const;
export const mcpScopeSchema = z.enum(MCP_SCOPES);
export type McpScope = z.infer<typeof mcpScopeSchema>;
export const MCP_READ_SCOPE: McpScope = 'atrium:read';

/** Callable names, shared so the web wrappers and the functions cannot drift. */
export const MCP_AUTH_REQUEST_INFO_CALLABLE = 'mcpAuthRequestInfo';
export const MCP_AUTHORIZE_CALLABLE = 'mcpAuthorize';
export const REVOKE_MCP_GRANT_CALLABLE = 'revokeMcpGrant';

export const mcpAuthRequestInfoRequestSchema = z.object({ requestId: idSchema }).strict();
export type McpAuthRequestInfoRequest = z.infer<typeof mcpAuthRequestInfoRequestSchema>;

/** What the consent page shows for a pending, unexpired authorization request. */
export const mcpAuthRequestInfoResultSchema = z.object({
  clientName: z.string().max(100),
  /** Host of the redirect URI, shown so the person knows where the code goes. */
  redirectHost: z.string().max(253),
  /** True for `localhost` / `127.0.0.1`: the code is sent to a program on this computer. */
  loopback: z.boolean(),
  requestedScopes: z.array(mcpScopeSchema),
  /** Epoch milliseconds. */
  expiresAt: z.number(),
});
export type McpAuthRequestInfoResult = z.infer<typeof mcpAuthRequestInfoResultSchema>;

export const mcpAuthorizeRequestSchema = z
  .object({
    requestId: idSchema,
    decision: z.enum(['allow', 'deny']),
    /** Subset of the requested scopes; must include `atrium:read`. Defaults to all requested. */
    scopes: z.array(mcpScopeSchema).max(MCP_SCOPES.length).optional(),
  })
  .strict();
export type McpAuthorizeRequest = z.infer<typeof mcpAuthorizeRequestSchema>;

/** Where the browser goes next: the client's redirect URI with `code` or `error` (and `state`). */
export const mcpAuthorizeResultSchema = z.object({ redirectUrl: z.string().max(4096) });
export type McpAuthorizeResult = z.infer<typeof mcpAuthorizeResultSchema>;

export const revokeMcpGrantRequestSchema = z.object({ grantId: idSchema }).strict();
export type RevokeMcpGrantRequest = z.infer<typeof revokeMcpGrantRequestSchema>;

export const revokeMcpGrantResultSchema = z.object({
  grantId: idSchema,
  /** False when the grant was already revoked (a repeat is a no-op). */
  revoked: z.boolean(),
});
export type RevokeMcpGrantResult = z.infer<typeof revokeMcpGrantResultSchema>;

/** `users/{uid}/mcpGrants/{grantId}`: one connected app. Clients never write it. */
export const mcpGrantSchema = z.object({
  clientId: idSchema,
  clientName: z.string().max(100),
  redirectHost: z.string().max(253),
  scopes: z.array(mcpScopeSchema),
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema,
  lastRefreshAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
});
export type McpGrant = z.infer<typeof mcpGrantSchema>;
