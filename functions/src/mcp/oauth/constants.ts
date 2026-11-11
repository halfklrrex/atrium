import { APP_BASE_URL } from '@atrium/shared';

/**
 * Hosted MCP connector, OAuth 2.1 authorization server (OPS4, sections 4 and 5). Every URL is built
 * from the one canonical origin; the issuer is the origin itself and the resource is `/mcp`.
 */

/** The canonical origin (issuer). `atrium-board.web.app` redirects here. */
export const ATRIUM_ORIGIN = APP_BASE_URL;
/** The RFC 8707 resource identifier every token is bound to. */
export const MCP_RESOURCE_URL = `${ATRIUM_ORIGIN}/mcp`;
/** The consent page in the web app; `?request=<id>` is appended. */
export const MCP_CONNECT_URL = `${ATRIUM_ORIGIN}/connect`;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Lifetimes (milliseconds), decision D4 and section 4.4. */
export const MCP_ACCESS_TOKEN_TTL_MS = HOUR;
export const MCP_REFRESH_TOKEN_TTL_MS = 30 * DAY;
export const MCP_GRANT_MAX_LIFE_MS = 90 * DAY;
export const MCP_AUTH_REQUEST_TTL_MS = 10 * MINUTE;
/** An unused registered client is forgotten this long after its last use (TTL on `expiresAt`). */
export const MCP_CLIENT_TTL_MS = 90 * DAY;
/** Audit entries live this long (TTL on `expiresAt`). */
export const MCP_AUDIT_TTL_MS = 90 * DAY;

/** The per-instance account-status cache of `verifyAccessToken` (section 4.4). */
export const MCP_ACCOUNT_CACHE_TTL_MS = 60 * 1000;
export const MCP_ACCOUNT_CACHE_MAX = 500;

/** `client_name` is cut to this many characters on registration (section 5, DCR abuse). */
export const MCP_CLIENT_NAME_MAX = 100;

/** Firestore collections (section 4.2). All Functions-only except `mcpGrants`. */
export const MCP_CLIENTS = 'mcpClients';
export const MCP_AUTH_REQUESTS = 'mcpAuthRequests';
export const MCP_TOKENS = 'mcpTokens';
export const MCP_GRANTS = 'mcpGrants';
export const MCP_USAGE = 'mcpUsage';
export const MCP_AUDIT_DOC = 'mcpAudit';
export const MCP_AUDIT_ENTRIES = 'entries';
