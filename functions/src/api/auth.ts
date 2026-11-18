import { API_TOKEN_PREFIX, type ApiTokenScope } from '@atrium/shared';
import { logger } from 'firebase-functions/v2';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { AccountStatusCache } from '../mcp/oauth/account-cache';
import { hashApiToken } from './tokens';
import type { ApiTokenStore } from './token-store';

/**
 * The one credential check of the public API (P8 section 3, "Verifier"): `Authorization: Bearer
 * <token>` is either a personal access token (`atrp_`, looked up by hash) or an OAuth access token
 * issued by the OPS4 server (everything else, verified by the existing provider). Both end as
 * `ApiAuthInfo`. A token never has more access than its user: the account must be approved on every
 * call (cached for at most 60 s per instance). Nothing here logs a token or an Authorization header.
 */

export interface ApiAuthInfo {
  uid: string;
  scopes: ApiTokenScope[];
  /** `null` means no workspace restriction. */
  workspaceIds: string[] | null;
  kind: 'pat' | 'oauth';
  /** Set for personal tokens, so routes can audit by token. */
  tokenId?: string;
}

export type ApiAuthFailure =
  'missing_token' | 'malformed_header' | 'invalid_token' | 'expired_token' | 'account_not_approved';

/** Every verifier failure is a 401 to the caller; `reason` is for the audit log only. */
export class ApiAuthError extends Error {
  readonly status = 401;
  constructor(readonly reason: ApiAuthFailure) {
    super(
      reason === 'missing_token' || reason === 'malformed_header'
        ? 'Send the token as "Authorization: Bearer <token>".'
        : 'The token is invalid, expired or revoked.',
    );
    this.name = 'ApiAuthError';
  }
}

/** Cache of a verified personal token and the throttle of `lastUsedAt` writes. */
export const API_AUTH_CACHE_TTL_MS = 60 * 1000;
export const API_AUTH_CACHE_MAX = 500;
export const API_LAST_USED_INTERVAL_MS = 60 * 1000;
/** A bearer value longer than this cannot be one of ours. */
const MAX_TOKEN_LENGTH = 512;

export interface ApiAuthDeps {
  store: ApiTokenStore;
  /** The OPS4 access-token check (`AtriumOAuthProvider.verifyAccessToken`); throws when invalid. */
  verifyOAuthToken: (token: string) => Promise<AuthInfo>;
  now?: () => number;
}

const BEARER = /^Bearer +([^\s]+)$/i;

/** The token in a `Bearer` header, or the failure to report. */
export function parseBearer(header: string | undefined | null): string {
  if (header === undefined || header === null || header.trim() === '') {
    throw new ApiAuthError('missing_token');
  }
  const match = BEARER.exec(header.trim());
  if (!match || match[1]!.length > MAX_TOKEN_LENGTH) throw new ApiAuthError('malformed_header');
  return match[1]!;
}

const OAUTH_SCOPE: Record<string, ApiTokenScope> = {
  'atrium:read': 'read',
  'atrium:write': 'write',
};

function oauthScopes(scopes: readonly string[]): ApiTokenScope[] {
  const out = new Set<ApiTokenScope>();
  for (const scope of scopes) {
    const mapped = OAUTH_SCOPE[scope];
    if (mapped) out.add(mapped);
  }
  return [...out];
}

interface CacheEntry {
  info: ApiAuthInfo;
  tokenExpiresAt: number;
  at: number;
}

export class ApiTokenVerifier {
  private readonly now: () => number;
  private readonly accounts: AccountStatusCache;
  private readonly cache = new Map<string, CacheEntry>();
  /** `uid/tokenId` -> when this instance last wrote `lastUsedAt`. */
  private readonly lastTouch = new Map<string, number>();

  constructor(private readonly deps: ApiAuthDeps) {
    this.now = deps.now ?? Date.now;
    this.accounts = new AccountStatusCache((uid) => deps.store.getAccountStatus(uid), this.now);
  }

  /** Verifies an `Authorization` header value. Throws `ApiAuthError`; never returns a half result. */
  async verify(authorizationHeader: string | undefined | null): Promise<ApiAuthInfo> {
    const token = parseBearer(authorizationHeader);
    return token.startsWith(API_TOKEN_PREFIX) ? this.verifyPat(token) : this.verifyOAuth(token);
  }

  private async verifyOAuth(token: string): Promise<ApiAuthInfo> {
    let info: AuthInfo;
    try {
      info = await this.deps.verifyOAuthToken(token);
    } catch {
      throw new ApiAuthError('invalid_token');
    }
    const uid = info.extra?.uid;
    if (typeof uid !== 'string' || uid === '') throw new ApiAuthError('invalid_token');
    return { uid, scopes: oauthScopes(info.scopes), workspaceIds: null, kind: 'oauth' };
  }

  private async verifyPat(token: string): Promise<ApiAuthInfo> {
    const now = this.now();
    const hash = hashApiToken(token);

    const hit = this.cache.get(hash);
    if (hit && now - hit.at < API_AUTH_CACHE_TTL_MS) {
      if (hit.tokenExpiresAt <= now) {
        this.cache.delete(hash);
        throw new ApiAuthError('expired_token');
      }
      return hit.info;
    }
    this.cache.delete(hash);

    const index = await this.deps.store.getIndex(hash);
    if (!index) throw new ApiAuthError('invalid_token');
    if (index.expiresAt <= now) throw new ApiAuthError('expired_token');
    const doc = await this.deps.store.getToken(index.uid, index.tokenId);
    if (!doc || doc.revokedAt !== null) throw new ApiAuthError('invalid_token');
    if (doc.expiresAt <= now) throw new ApiAuthError('expired_token');
    if ((await this.accounts.get(index.uid)) !== 'approved') {
      throw new ApiAuthError('account_not_approved');
    }

    const info: ApiAuthInfo = {
      uid: index.uid,
      scopes: [...doc.scopes],
      workspaceIds: doc.workspaceIds ? [...doc.workspaceIds] : null,
      kind: 'pat',
      tokenId: index.tokenId,
    };
    if (this.cache.size >= API_AUTH_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(hash, { info, tokenExpiresAt: doc.expiresAt, at: now });
    await this.touchLastUsed(index.uid, index.tokenId, doc.lastUsedAt, now);
    return info;
  }

  /** At most one write a minute per token (per instance, and across instances via the document). */
  private async touchLastUsed(
    uid: string,
    tokenId: string,
    lastUsedAt: number | null,
    now: number,
  ): Promise<void> {
    const key = `${uid}/${tokenId}`;
    const last = Math.max(lastUsedAt ?? 0, this.lastTouch.get(key) ?? 0);
    if (last !== 0 && now - last < API_LAST_USED_INTERVAL_MS) return;
    this.lastTouch.set(key, now);
    if (this.lastTouch.size > API_AUTH_CACHE_MAX) {
      const oldest = this.lastTouch.keys().next().value;
      if (oldest !== undefined) this.lastTouch.delete(oldest);
    }
    try {
      await this.deps.store.touchLastUsed(uid, tokenId, now);
    } catch (error) {
      // Best effort: a failed bookkeeping write never fails the request.
      logger.error('Could not record the use of an API token', { uid, tokenId, error });
    }
  }

  /** Forgets everything cached for a token or account, so a change made here is seen at once. */
  invalidate(uid: string): void {
    this.accounts.invalidate(uid);
    for (const [hash, entry] of this.cache) if (entry.info.uid === uid) this.cache.delete(hash);
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}

const verifiers = new WeakMap<ApiAuthDeps, ApiTokenVerifier>();

/**
 * The entry point routes call: `verifyApiToken(header, deps)`. The caches live on a verifier kept
 * per `deps` object, so pass the same object on every request (one module-level constant).
 */
export function verifyApiToken(
  authorizationHeader: string | undefined | null,
  deps: ApiAuthDeps,
): Promise<ApiAuthInfo> {
  let verifier = verifiers.get(deps);
  if (!verifier) {
    verifier = new ApiTokenVerifier(deps);
    verifiers.set(deps, verifier);
  }
  return verifier.verify(authorizationHeader);
}
