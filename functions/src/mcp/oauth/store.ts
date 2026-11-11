import type { AccountStatus, McpScope } from '@atrium/shared';

/**
 * The narrow storage interface of the OAuth provider and the consent callables (OPS4 section 4.2).
 * Times are epoch milliseconds here; `admin-store.ts` maps them to Firestore timestamps (the TTL
 * policies need real timestamps) and `fake-store.ts` keeps them in memory for the unit tests.
 */

export type McpAuthRequestStatus = 'pending' | 'approved' | 'denied' | 'exchanged';
export type McpTokenKind = 'access' | 'refresh';
export type McpAuditKind =
  'grant_created' | 'grant_revoked' | 'token_refreshed' | 'tool_call' | 'auth_denied';

/** `mcpClients/{clientId}`: a dynamically registered public client. */
export interface McpClientDoc {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: 'none';
  grantTypes: string[];
  responseTypes: string[];
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
}

/** `mcpAuthRequests/{requestId}`: one parked `/authorize` request, until the code is exchanged. */
export interface McpAuthRequestDoc {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  requestedScopes: McpScope[];
  resource: string;
  status: McpAuthRequestStatus;
  uid: string | null;
  scopes: McpScope[] | null;
  codeHash: string | null;
  /** Set when the code is exchanged, so a replay of the code can revoke the grant it created. */
  grantId: string | null;
  createdAt: number;
  expiresAt: number;
}

/** `mcpTokens/{sha256hex}`: one access or refresh token. The document id is the token's hash. */
export interface McpTokenDoc {
  kind: McpTokenKind;
  uid: string;
  clientId: string;
  grantId: string;
  scopes: McpScope[];
  resource: string;
  createdAt: number;
  expiresAt: number;
  /** Refresh tokens only: set when rotated. A rotated token presented again is reuse. */
  usedAt: number | null;
}

/** `users/{uid}/mcpGrants/{grantId}`: one connected app, as the Connected apps card lists it. */
export interface McpGrantDoc {
  clientId: string;
  clientName: string;
  redirectHost: string;
  scopes: McpScope[];
  createdAt: number;
  lastUsedAt: number;
  lastRefreshAt: number | null;
  revokedAt: number | null;
}

/** `system/mcpAudit/entries/{id}`. No token, code, email or name ever goes in here. */
export interface McpAuditEntry {
  kind: McpAuditKind;
  at: number;
  uid: string;
  clientId: string;
  grantId?: string;
  tool?: string;
  boardId?: string;
  ok?: boolean;
  error?: string;
  ms?: number;
  expiresAt: number;
}

export interface McpGrantRef {
  uid: string;
  grantId: string;
  doc: McpGrantDoc;
}

/**
 * What a transaction may do. Firestore requires every read before the first write, and the logic
 * keeps to that order; the fake does not check it, the emulator test does.
 */
export interface McpTx {
  getAuthRequest(requestId: string): Promise<McpAuthRequestDoc | null>;
  getToken(hash: string): Promise<McpTokenDoc | null>;
  getGrant(uid: string, grantId: string): Promise<McpGrantDoc | null>;
  /** `users/{uid}.accountStatus`, null when the user or the field is missing. */
  getAccountStatus(uid: string): Promise<AccountStatus | null>;
  updateAuthRequest(requestId: string, patch: Partial<McpAuthRequestDoc>): void;
  setToken(hash: string, doc: McpTokenDoc): void;
  updateToken(hash: string, patch: Partial<McpTokenDoc>): void;
  setGrant(uid: string, grantId: string, doc: McpGrantDoc): void;
  updateGrant(uid: string, grantId: string, patch: Partial<McpGrantDoc>): void;
}

export interface McpStore {
  getClient(clientId: string): Promise<McpClientDoc | null>;
  setClient(doc: McpClientDoc): Promise<void>;
  /** Refreshes `lastUsedAt` and pushes `expiresAt` out. Best effort for the caller. */
  touchClient(clientId: string, lastUsedAt: number, expiresAt: number): Promise<void>;
  createAuthRequest(requestId: string, doc: McpAuthRequestDoc): Promise<void>;
  getAuthRequest(requestId: string): Promise<McpAuthRequestDoc | null>;
  getToken(hash: string): Promise<McpTokenDoc | null>;
  getAccountStatus(uid: string): Promise<AccountStatus | null>;
  getGrant(uid: string, grantId: string): Promise<McpGrantDoc | null>;
  /** The grants of one user that are not revoked. */
  listActiveGrants(uid: string): Promise<McpGrantRef[]>;
  /** The ids (hashes) of every token document of a grant (`mcpTokens` where `grantId ==`). */
  listGrantTokenHashes(grantId: string): Promise<string[]>;
  deleteTokens(hashes: string[]): Promise<void>;
  updateGrant(uid: string, grantId: string, patch: Partial<McpGrantDoc>): Promise<void>;
  appendAudit(entry: McpAuditEntry): Promise<void>;
  runTransaction<T>(fn: (tx: McpTx) => Promise<T>): Promise<T>;
  /** A fresh random document id (request ids, grant ids). */
  newId(): string;
}
