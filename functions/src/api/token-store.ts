import type { AccountStatus, ApiTokenScope } from '@atrium/shared';

/**
 * Storage seam for personal access tokens (P8 section 3). The logic in `tokens.ts` and `auth.ts`
 * talks to this narrow interface, so it is unit tested with the in-memory fake; `admin-token-store.ts`
 * adapts Firestore. Every time is epoch milliseconds here (Timestamps only in the adapter).
 */

/** `users/{uid}/apiTokens/{tokenId}`. Never holds the secret or its hash. */
export interface ApiTokenDoc {
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  /** `null` means no workspace restriction. */
  workspaceIds: string[] | null;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** `apiTokenIndex/{sha256hex}`: how the verifier finds a token from the presented secret. */
export interface ApiTokenIndexDoc {
  uid: string;
  tokenId: string;
  expiresAt: number;
}

export interface ApiTokenRef {
  uid: string;
  tokenId: string;
  doc: ApiTokenDoc;
}

export interface ApiTokenStore {
  getIndex(hash: string): Promise<ApiTokenIndexDoc | null>;
  getToken(uid: string, tokenId: string): Promise<ApiTokenDoc | null>;
  /** Tokens that are not revoked (they may be expired). */
  listUnrevokedTokens(uid: string): Promise<ApiTokenRef[]>;
  /** `users/{uid}.accountStatus`, `null` when missing. */
  getAccountStatus(uid: string): Promise<AccountStatus | null>;
  /** True when `uid` is a member of the workspace (`workspaces/{id}.roles[uid]`). */
  isWorkspaceMember(uid: string, workspaceId: string): Promise<boolean>;
  /**
   * Writes the token document and its index document together, but only when the person has fewer
   * than `maxActive` unrevoked, unexpired tokens (checked in the same transaction). False when full.
   */
  createTokenIfRoom(args: {
    uid: string;
    tokenId: string;
    doc: ApiTokenDoc;
    hash: string;
    index: ApiTokenIndexDoc;
    now: number;
    maxActive: number;
  }): Promise<boolean>;
  /** Sets `revokedAt` and deletes the index document(s) of the token. */
  revokeToken(uid: string, tokenId: string, now: number): Promise<void>;
  touchLastUsed(uid: string, tokenId: string, now: number): Promise<void>;
  newId(): string;
}
