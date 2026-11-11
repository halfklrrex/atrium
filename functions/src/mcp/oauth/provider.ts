import { MCP_SCOPES, type McpScope } from '@atrium/shared';
import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { AccountStatusCache } from './account-cache';
import { writeMcpAudit } from './audit';
import { McpClientsStore } from './clients';
import {
  MCP_ACCESS_TOKEN_TTL_MS,
  MCP_AUTH_REQUEST_TTL_MS,
  MCP_CLIENT_TTL_MS,
  MCP_CONNECT_URL,
  MCP_GRANT_MAX_LIFE_MS,
  MCP_REFRESH_TOKEN_TTL_MS,
  MCP_RESOURCE_URL,
} from './constants';
import { revokeGrant } from './grants';
import type { McpAuthRequestDoc, McpStore, McpTokenDoc, McpTx } from './store';
import { authCodeRequestId, hashSecret, newToken, secretMatchesHash } from './tokens';

/**
 * Atrium's OAuth 2.1 authorization server over Firestore (OPS4 section 4), plugged into the SDK's
 * `mcpAuthRouter` and `requireBearerAuth` by PR E. User sign-in is not done here: `authorize()`
 * parks the request and sends the browser to the web app's consent page, and the `mcpAuthorize`
 * callable (consent.ts) turns the signed-in uid into a code. Nothing in this file logs a token, a
 * code or an Authorization header.
 */

/** Only what the provider needs from Express: the SDK's handler passes the real `Response`. */
export interface RedirectResponse {
  redirect(url: string): void;
}

export interface ProviderOptions {
  now?: () => number;
}

/** The resource a request or token names, compared without a fragment or one trailing slash. */
export const isCanonicalResource = (resource: URL | string): boolean =>
  String(resource).replace(/#.*$/, '').replace(/\/$/, '') === MCP_RESOURCE_URL;

const hostOf = (uri: string): string => {
  try {
    return new URL(uri).host;
  } catch {
    return '';
  }
};

const seconds = (ms: number): number => Math.floor(ms / 1000);

export class AtriumOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: McpClientsStore;
  readonly accountStatus: AccountStatusCache;
  private readonly now: () => number;

  constructor(
    private readonly store: McpStore,
    options: ProviderOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.clientsStore = new McpClientsStore(store, this.now);
    this.accountStatus = new AccountStatusCache((uid) => store.getAccountStatus(uid), this.now);
  }

  /** Step 2 of the flow: park the request for 10 minutes and send the browser to `/connect`. */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: RedirectResponse,
  ): Promise<void> {
    if (params.resource !== undefined && !isCanonicalResource(params.resource)) {
      throw new InvalidTargetError('Unknown resource');
    }
    const requestedScopes = params.scopes && params.scopes.length > 0 ? params.scopes : MCP_SCOPES;
    for (const scope of requestedScopes) {
      if (!(MCP_SCOPES as readonly string[]).includes(scope)) {
        throw new InvalidScopeError(`Unknown scope: ${scope.slice(0, 40)}`);
      }
    }
    const now = this.now();
    const requestId = this.store.newId();
    const doc: McpAuthRequestDoc = {
      clientId: client.client_id,
      clientName: client.client_name ?? 'Unnamed app',
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? null,
      requestedScopes: [...new Set(requestedScopes as McpScope[])],
      resource: MCP_RESOURCE_URL,
      status: 'pending',
      uid: null,
      scopes: null,
      codeHash: null,
      grantId: null,
      createdAt: now,
      expiresAt: now + MCP_AUTH_REQUEST_TTL_MS,
    };
    await this.store.createAuthRequest(requestId, doc);
    await this.touchClient(client.client_id, now);
    const url = new URL(MCP_CONNECT_URL);
    url.searchParams.set('request', requestId);
    res.redirect(url.toString());
  }

  /** The SDK checks PKCE with this before it calls `exchangeAuthorizationCode`. */
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const requestId = authCodeRequestId(authorizationCode);
    const request = requestId ? await this.store.getAuthRequest(requestId) : null;
    if (!request || request.clientId !== client.client_id || !request.codeHash) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    return request.codeChallenge;
  }

  /** Step 5: one code, one grant. A replayed code revokes the grant it created. */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const invalid = () => new InvalidGrantError('Invalid authorization code');
    const requestId = authCodeRequestId(authorizationCode);
    if (!requestId) throw invalid();
    if (resource !== undefined && !isCanonicalResource(resource)) {
      throw new InvalidTargetError('Unknown resource');
    }
    const now = this.now();

    type Outcome =
      | { kind: 'ok'; tokens: OAuthTokens; uid: string; grantId: string }
      | { kind: 'replay'; uid: string; grantId: string }
      | { kind: 'not-approved'; uid: string };
    const outcome = await this.store.runTransaction<Outcome>(async (tx) => {
      const request = await tx.getAuthRequest(requestId);
      if (!request || request.clientId !== client.client_id) throw invalid();
      if (!secretMatchesHash(authorizationCode, request.codeHash)) throw invalid();
      if (request.status === 'exchanged' && request.uid && request.grantId) {
        return { kind: 'replay', uid: request.uid, grantId: request.grantId };
      }
      if (request.status !== 'approved' || !request.uid || !request.scopes) throw invalid();
      if (request.expiresAt <= now) throw new InvalidGrantError('Authorization code has expired');
      if (redirectUri !== undefined && redirectUri !== request.redirectUri) {
        throw new InvalidGrantError('redirect_uri does not match the authorization request');
      }
      if (!isCanonicalResource(request.resource)) throw new InvalidTargetError('Unknown resource');
      const status = await tx.getAccountStatus(request.uid);
      if (status !== 'approved') return { kind: 'not-approved', uid: request.uid };

      const grantId = this.store.newId();
      const tokens = issueTokenPair(tx, {
        uid: request.uid,
        clientId: client.client_id,
        grantId,
        scopes: request.scopes,
        now,
        grantCreatedAt: now,
      });
      tx.setGrant(request.uid, grantId, {
        clientId: client.client_id,
        clientName: request.clientName,
        redirectHost: hostOf(request.redirectUri),
        scopes: request.scopes,
        createdAt: now,
        lastUsedAt: now,
        lastRefreshAt: null,
        revokedAt: null,
      });
      tx.updateAuthRequest(requestId, { status: 'exchanged', grantId });
      return { kind: 'ok', tokens, uid: request.uid, grantId };
    });

    if (outcome.kind === 'replay') {
      const doc = await this.store.getGrant(outcome.uid, outcome.grantId);
      if (doc)
        await revokeGrant(this.store, now, { uid: outcome.uid, grantId: outcome.grantId, doc });
      await writeMcpAudit(this.store, now, {
        kind: 'auth_denied',
        uid: outcome.uid,
        clientId: client.client_id,
        grantId: outcome.grantId,
        error: 'code_replayed',
      });
      throw new InvalidGrantError('Authorization code was already used');
    }
    if (outcome.kind === 'not-approved') {
      await writeMcpAudit(this.store, now, {
        kind: 'auth_denied',
        uid: outcome.uid,
        clientId: client.client_id,
        error: 'account_not_approved',
      });
      throw new InvalidGrantError('Account is not approved');
    }
    await writeMcpAudit(this.store, now, {
      kind: 'grant_created',
      uid: outcome.uid,
      clientId: client.client_id,
      grantId: outcome.grantId,
    });
    return outcome.tokens;
  }

  /** Step 7: rotation with reuse detection; the grant's absolute life caps every expiry. */
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const invalid = () => new InvalidGrantError('Invalid refresh token');
    if (resource !== undefined && !isCanonicalResource(resource)) {
      throw new InvalidTargetError('Unknown resource');
    }
    const hash = hashSecret(refreshToken);
    const now = this.now();

    type Outcome =
      | { kind: 'ok'; tokens: OAuthTokens; uid: string; grantId: string }
      | { kind: 'reused'; uid: string; grantId: string }
      | { kind: 'denied'; uid: string; grantId: string; error: string; message: string };
    const outcome = await this.store.runTransaction<Outcome>(async (tx) => {
      const token = await tx.getToken(hash);
      if (!token || token.kind !== 'refresh' || token.clientId !== client.client_id)
        throw invalid();
      const { uid, grantId } = token;
      if (token.usedAt !== null) return { kind: 'reused', uid, grantId };
      if (token.expiresAt <= now) throw new InvalidGrantError('Refresh token has expired');
      const grant = await tx.getGrant(uid, grantId);
      if (!grant || grant.revokedAt !== null) {
        return { kind: 'denied', uid, grantId, error: 'grant_revoked', message: 'Grant revoked' };
      }
      const status = await tx.getAccountStatus(uid);
      if (status !== 'approved') {
        const message = 'Account is not approved';
        return { kind: 'denied', uid, grantId, error: 'account_not_approved', message };
      }
      const granted = grant.scopes;
      let nextScopes: McpScope[] = granted;
      if (scopes && scopes.length > 0) {
        for (const scope of scopes) {
          if (!(granted as string[]).includes(scope)) {
            throw new InvalidScopeError('Requested scope exceeds the grant');
          }
        }
        nextScopes = granted.filter((scope) => scopes.includes(scope));
      }
      if (grant.createdAt + MCP_GRANT_MAX_LIFE_MS <= now) {
        return { kind: 'denied', uid, grantId, error: 'grant_expired', message: 'Grant expired' };
      }
      const tokens = issueTokenPair(tx, {
        uid,
        clientId: client.client_id,
        grantId,
        scopes: nextScopes,
        now,
        grantCreatedAt: grant.createdAt,
      });
      tx.updateToken(hash, { usedAt: now });
      tx.updateGrant(uid, grantId, { lastRefreshAt: now, lastUsedAt: now });
      return { kind: 'ok', tokens, uid, grantId };
    });

    if (outcome.kind === 'reused') {
      const doc = await this.store.getGrant(outcome.uid, outcome.grantId);
      if (doc)
        await revokeGrant(this.store, now, { uid: outcome.uid, grantId: outcome.grantId, doc });
      await writeMcpAudit(this.store, now, {
        kind: 'auth_denied',
        uid: outcome.uid,
        clientId: client.client_id,
        grantId: outcome.grantId,
        error: 'refresh_token_reused',
      });
      throw new InvalidGrantError('Refresh token was already used');
    }
    if (outcome.kind === 'denied') {
      await writeMcpAudit(this.store, now, {
        kind: 'auth_denied',
        uid: outcome.uid,
        clientId: client.client_id,
        grantId: outcome.grantId,
        error: outcome.error,
      });
      throw new InvalidGrantError(outcome.message);
    }
    await this.touchClient(client.client_id, now);
    await writeMcpAudit(this.store, now, {
      kind: 'token_refreshed',
      uid: outcome.uid,
      clientId: client.client_id,
      grantId: outcome.grantId,
    });
    return outcome.tokens;
  }

  /** Step 6: one read per request, plus the cached account gate. */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const doc = await this.store.getToken(hashSecret(token));
    if (!doc || doc.kind !== 'access') throw new InvalidTokenError('Invalid token');
    const now = this.now();
    if (doc.expiresAt <= now) throw new InvalidTokenError('Token has expired');
    if (!isCanonicalResource(doc.resource)) {
      throw new InvalidTokenError('Token was not issued for this resource');
    }
    const status = await this.accountStatus.get(doc.uid);
    if (status !== 'approved') throw new InvalidTokenError('Account is not approved');
    return {
      token,
      clientId: doc.clientId,
      scopes: doc.scopes,
      expiresAt: seconds(doc.expiresAt),
      resource: new URL(MCP_RESOURCE_URL),
      extra: { uid: doc.uid, grantId: doc.grantId },
    };
  }

  /** `POST /revoke`: either token of a grant ends the whole grant. Unknown tokens do nothing. */
  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const hash = hashSecret(request.token);
    const doc = await this.store.getToken(hash);
    if (!doc || doc.clientId !== client.client_id) return;
    const now = this.now();
    const grant = await this.store.getGrant(doc.uid, doc.grantId);
    if (grant) {
      await revokeGrant(this.store, now, { uid: doc.uid, grantId: doc.grantId, doc: grant });
    } else {
      await this.store.deleteTokens([hash]);
    }
    this.accountStatus.invalidate(doc.uid);
  }

  private async touchClient(clientId: string, now: number): Promise<void> {
    try {
      await this.store.touchClient(clientId, now, now + MCP_CLIENT_TTL_MS);
    } catch {
      // Best effort: the client row only drives the unused-client TTL.
    }
  }
}

interface IssueInput {
  uid: string;
  clientId: string;
  grantId: string;
  scopes: McpScope[];
  now: number;
  grantCreatedAt: number;
}

/**
 * Writes one access and one refresh token document (inside the caller's transaction) and returns
 * the token response. Both expiries are capped by the grant's absolute life (90 days).
 */
function issueTokenPair(tx: McpTx, input: IssueInput): OAuthTokens {
  const { uid, clientId, grantId, scopes, now, grantCreatedAt } = input;
  const grantEnd = grantCreatedAt + MCP_GRANT_MAX_LIFE_MS;
  const accessExpiresAt = Math.min(now + MCP_ACCESS_TOKEN_TTL_MS, grantEnd);
  const refreshExpiresAt = Math.min(now + MCP_REFRESH_TOKEN_TTL_MS, grantEnd);
  const accessToken = newToken();
  const refreshToken = newToken();
  const base: Omit<McpTokenDoc, 'kind' | 'expiresAt'> = {
    uid,
    clientId,
    grantId,
    scopes,
    resource: MCP_RESOURCE_URL,
    createdAt: now,
    usedAt: null,
  };
  tx.setToken(hashSecret(accessToken), { ...base, kind: 'access', expiresAt: accessExpiresAt });
  tx.setToken(hashSecret(refreshToken), { ...base, kind: 'refresh', expiresAt: refreshExpiresAt });
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: seconds(accessExpiresAt - now),
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  };
}
