import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { describe, expect, it } from 'vitest';
import { MCP_CONNECT_URL, MCP_RESOURCE_URL } from './constants';
import { CLAUDE_REDIRECT, DAY, HOUR, MINUTE, T0, UID, harness, rejection } from './test-helpers';
import { hashSecret } from './tokens';

const TOKEN_RE = /^atr_[A-Za-z0-9_-]{43}$/;

describe('authorize', () => {
  it('parks the request for 10 minutes and redirects to the consent page', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId, redirectedTo } = await h.startAuth(client);
    expect(redirectedTo).toBe(`${MCP_CONNECT_URL}?request=${requestId}`);
    expect(h.store.requests.get(requestId)).toEqual({
      clientId: client.client_id,
      clientName: 'Claude',
      redirectUri: CLAUDE_REDIRECT,
      codeChallenge: 'challenge-s256',
      state: 'state-1',
      requestedScopes: ['atrium:read', 'atrium:write'],
      resource: MCP_RESOURCE_URL,
      status: 'pending',
      uid: null,
      scopes: null,
      codeHash: null,
      grantId: null,
      createdAt: T0,
      expiresAt: T0 + 10 * MINUTE,
    });
    expect(h.store.clients.get(client.client_id)!.lastUsedAt).toBe(T0);
  });

  it('defaults to both scopes when none are requested and keeps a single one', async () => {
    const h = harness();
    const client = await h.register();
    const a = await h.startAuth(client, { scopes: [] });
    expect(h.store.requests.get(a.requestId)!.requestedScopes).toEqual([
      'atrium:read',
      'atrium:write',
    ]);
    const b = await h.startAuth(client, { scopes: ['atrium:read'], state: undefined });
    expect(h.store.requests.get(b.requestId)).toMatchObject({
      requestedScopes: ['atrium:read'],
      state: null,
    });
  });

  it('refuses an unknown scope and a foreign resource before storing anything', async () => {
    const h = harness();
    const client = await h.register();
    await expect(h.startAuth(client, { scopes: ['atrium:admin'] })).rejects.toBeInstanceOf(
      InvalidScopeError,
    );
    await expect(
      h.startAuth(client, { resource: new URL('https://evil.example.com/mcp') }),
    ).rejects.toBeInstanceOf(InvalidTargetError);
    expect(h.store.requests.size).toBe(0);
  });

  it('accepts the canonical resource with a trailing slash or fragment, or none at all', async () => {
    const h = harness();
    const client = await h.register();
    await h.startAuth(client, { resource: new URL(`${MCP_RESOURCE_URL}/`) });
    await h.startAuth(client, { resource: new URL(`${MCP_RESOURCE_URL}#x`) });
    await h.startAuth(client, { resource: undefined });
    expect(h.store.requests.size).toBe(3);
    for (const request of h.store.requests.values())
      expect(request.resource).toBe(MCP_RESOURCE_URL);
  });
});

describe('challengeForAuthorizationCode', () => {
  it('returns the stored challenge for a consented code of the same client', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    const code = await h.consent(requestId);
    expect(await h.provider.challengeForAuthorizationCode(client, code)).toBe('challenge-s256');
  });

  it('refuses a code of another client, an unconsented request, or garbage', async () => {
    const h = harness();
    const client = await h.register();
    const other = await h.register();
    const { requestId } = await h.startAuth(client);
    await expect(
      h.provider.challengeForAuthorizationCode(client, `${requestId}.secret`),
    ).rejects.toBeInstanceOf(InvalidGrantError);
    const code = await h.consent(requestId);
    await expect(h.provider.challengeForAuthorizationCode(other, code)).rejects.toBeInstanceOf(
      InvalidGrantError,
    );
    for (const bad of ['', 'nodot', '.secret', 'id.', 'nope.secret', '../x.y']) {
      await expect(h.provider.challengeForAuthorizationCode(client, bad)).rejects.toBeInstanceOf(
        InvalidGrantError,
      );
    }
  });
});

describe('exchangeAuthorizationCode', () => {
  it('issues a grant, an access token and a refresh token, storing hashes only', async () => {
    const h = harness();
    const { client, requestId, code, tokens, grantId } = await h.connect();
    expect(tokens).toEqual({
      access_token: expect.stringMatching(TOKEN_RE),
      refresh_token: expect.stringMatching(TOKEN_RE),
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'atrium:read atrium:write',
    });
    expect(tokens.access_token).not.toBe(tokens.refresh_token);

    const access = h.store.tokens.get(hashSecret(tokens.access_token));
    const refresh = h.store.tokens.get(hashSecret(tokens.refresh_token!));
    const base = {
      uid: UID,
      clientId: client.client_id,
      grantId,
      scopes: ['atrium:read', 'atrium:write'],
      resource: MCP_RESOURCE_URL,
      createdAt: T0,
      usedAt: null,
    };
    expect(access).toEqual({ ...base, kind: 'access', expiresAt: T0 + HOUR });
    expect(refresh).toEqual({ ...base, kind: 'refresh', expiresAt: T0 + 30 * DAY });

    expect(h.store.grants.get(`${UID}/${grantId}`)).toEqual({
      clientId: client.client_id,
      clientName: 'Claude',
      redirectHost: 'claude.ai',
      scopes: ['atrium:read', 'atrium:write'],
      createdAt: T0,
      lastUsedAt: T0,
      lastRefreshAt: null,
      revokedAt: null,
    });
    expect(h.store.requests.get(requestId)).toMatchObject({ status: 'exchanged', grantId });
    expect(h.store.audit.map((e) => e.kind)).toEqual(['grant_created']);
    expect(h.store.audit[0]).toMatchObject({ uid: UID, grantId, expiresAt: T0 + 90 * DAY });

    const stored = h.store.allStoredText();
    for (const secret of [tokens.access_token, tokens.refresh_token!, code]) {
      expect(stored).not.toContain(secret);
      expect(stored).not.toContain(secret.slice(4, 20));
    }
  });

  it('accepts a token request without redirect_uri or resource', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    const code = await h.consent(requestId);
    const tokens = await h.provider.exchangeAuthorizationCode(client, code);
    expect(tokens.access_token).toMatch(TOKEN_RE);
  });

  it('refuses another client, another redirect URI and another resource', async () => {
    const h = harness();
    const client = await h.register();
    const other = await h.register();
    const { requestId } = await h.startAuth(client);
    const code = await h.consent(requestId);
    const exchange = (c = client, redirect = CLAUDE_REDIRECT, resource = MCP_RESOURCE_URL) =>
      h.provider.exchangeAuthorizationCode(c, code, undefined, redirect, new URL(resource));
    expect(await rejection(exchange(other))).toBeInstanceOf(InvalidGrantError);
    expect(
      await rejection(exchange(client, 'https://claude.com/api/mcp/auth_callback')),
    ).toBeInstanceOf(InvalidGrantError);
    expect(
      await rejection(exchange(client, CLAUDE_REDIRECT, 'https://atrium-workboards.web.app/other')),
    ).toBeInstanceOf(InvalidTargetError);
    // The request is untouched, so the right client can still exchange it.
    expect(h.store.requests.get(requestId)!.status).toBe('approved');
    await exchange();
    expect(h.store.grants.size).toBe(1);
  });

  it('refuses an expired code, an unconsented request and a denied request', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    const code = await h.consent(requestId);
    h.clock.now = T0 + 10 * MINUTE;
    expect(await rejection(h.provider.exchangeAuthorizationCode(client, code))).toBeInstanceOf(
      InvalidGrantError,
    );
    h.clock.now = T0;
    const pending = await h.startAuth(client);
    expect(
      await rejection(h.provider.exchangeAuthorizationCode(client, `${pending.requestId}.x`)),
    ).toBeInstanceOf(InvalidGrantError);
    const denied = await h.startAuth(client);
    h.store.requests.get(denied.requestId)!.status = 'denied';
    expect(
      await rejection(h.provider.exchangeAuthorizationCode(client, `${denied.requestId}.x`)),
    ).toBeInstanceOf(InvalidGrantError);
    expect(h.store.grants.size).toBe(0);
  });

  it('a replayed code revokes the grant it created; a wrong secret does not', async () => {
    const h = harness();
    const { client, requestId, code, tokens, grantId } = await h.connect();
    // Guessing the secret behind a known request id revokes nothing.
    expect(
      await rejection(h.provider.exchangeAuthorizationCode(client, `${requestId}.wrong`)),
    ).toBeInstanceOf(InvalidGrantError);
    expect(h.store.grants.get(`${UID}/${grantId}`)!.revokedAt).toBeNull();
    await h.provider.verifyAccessToken(tokens.access_token);

    const error = await rejection(h.provider.exchangeAuthorizationCode(client, code));
    expect(error).toBeInstanceOf(InvalidGrantError);
    expect(h.store.grants.get(`${UID}/${grantId}`)!.revokedAt).toBe(T0);
    expect(h.store.tokens.size).toBe(0);
    await expect(h.provider.verifyAccessToken(tokens.access_token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    expect(h.store.audit.map((e) => e.kind)).toEqual([
      'grant_created',
      'grant_revoked',
      'auth_denied',
    ]);
    expect(h.store.audit[2]).toMatchObject({ error: 'code_replayed', grantId });
  });

  it('refuses an account that is no longer approved at exchange time', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    const code = await h.consent(requestId);
    h.store.accounts.set(UID, 'blocked');
    expect(await rejection(h.provider.exchangeAuthorizationCode(client, code))).toBeInstanceOf(
      InvalidGrantError,
    );
    expect(h.store.grants.size).toBe(0);
    expect(h.store.tokens.size).toBe(0);
    expect(h.store.audit).toEqual([
      expect.objectContaining({ kind: 'auth_denied', error: 'account_not_approved', uid: UID }),
    ]);
  });
});

describe('exchangeRefreshToken', () => {
  it('rotates: a new pair, the old refresh token marked used, the grant touched', async () => {
    const h = harness();
    const { client, tokens, grantId } = await h.connect();
    h.clock.now = T0 + 20 * MINUTE;
    const next = await h.provider.exchangeRefreshToken(client, tokens.refresh_token!);
    expect(next).toEqual({
      access_token: expect.stringMatching(TOKEN_RE),
      refresh_token: expect.stringMatching(TOKEN_RE),
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'atrium:read atrium:write',
    });
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(h.store.tokens.get(hashSecret(tokens.refresh_token!))!.usedAt).toBe(h.clock.now);
    expect(h.store.tokens.get(hashSecret(next.refresh_token!))).toMatchObject({
      kind: 'refresh',
      usedAt: null,
      expiresAt: h.clock.now + 30 * DAY,
    });
    expect(h.store.grants.get(`${UID}/${grantId}`)).toMatchObject({
      lastRefreshAt: h.clock.now,
      lastUsedAt: h.clock.now,
      revokedAt: null,
    });
    expect(h.store.audit.map((e) => e.kind)).toEqual(['grant_created', 'token_refreshed']);
    // Both access tokens stay valid until they expire.
    await h.provider.verifyAccessToken(tokens.access_token);
    await h.provider.verifyAccessToken(next.access_token);
  });

  it('a reused refresh token revokes the whole grant', async () => {
    const h = harness();
    const { client, tokens, grantId } = await h.connect();
    const next = await h.provider.exchangeRefreshToken(client, tokens.refresh_token!);
    expect(
      await rejection(h.provider.exchangeRefreshToken(client, tokens.refresh_token!)),
    ).toBeInstanceOf(InvalidGrantError);
    expect(h.store.grants.get(`${UID}/${grantId}`)!.revokedAt).toBe(T0);
    expect(h.store.tokens.size).toBe(0);
    await expect(h.provider.verifyAccessToken(next.access_token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    expect(
      await rejection(h.provider.exchangeRefreshToken(client, next.refresh_token!)),
    ).toBeInstanceOf(InvalidGrantError);
    expect(h.store.audit.at(-1)).toMatchObject({
      kind: 'auth_denied',
      error: 'refresh_token_reused',
    });
  });

  it('refuses an unknown token, an access token, another client and a foreign resource', async () => {
    const h = harness();
    const { client, tokens } = await h.connect();
    const other = await h.register();
    const cases: Array<() => Promise<unknown>> = [
      () => h.provider.exchangeRefreshToken(client, 'atr_unknown'),
      () => h.provider.exchangeRefreshToken(client, tokens.access_token),
      () => h.provider.exchangeRefreshToken(other, tokens.refresh_token!),
    ];
    for (const run of cases) expect(await rejection(run())).toBeInstanceOf(InvalidGrantError);
    expect(
      await rejection(
        h.provider.exchangeRefreshToken(
          client,
          tokens.refresh_token!,
          undefined,
          new URL('https://x.example/mcp'),
        ),
      ),
    ).toBeInstanceOf(InvalidTargetError);
    // None of those consumed the refresh token.
    await h.provider.exchangeRefreshToken(client, tokens.refresh_token!);
  });

  it('refuses an expired refresh token, a revoked grant and a blocked account', async () => {
    const h = harness();
    const { client, tokens } = await h.connect();
    h.clock.now = T0 + 30 * DAY;
    expect(
      await rejection(h.provider.exchangeRefreshToken(client, tokens.refresh_token!)),
    ).toBeInstanceOf(InvalidGrantError);
    h.clock.now = T0;
    const second = await h.connect();
    h.store.grants.get(`${UID}/${second.grantId}`)!.revokedAt = T0;
    expect(
      await rejection(h.provider.exchangeRefreshToken(second.client, second.tokens.refresh_token!)),
    ).toBeInstanceOf(InvalidGrantError);
    expect(h.store.audit.at(-1)).toMatchObject({ kind: 'auth_denied', error: 'grant_revoked' });
    const third = await h.connect();
    h.store.accounts.set(UID, 'pending');
    expect(
      await rejection(h.provider.exchangeRefreshToken(third.client, third.tokens.refresh_token!)),
    ).toBeInstanceOf(InvalidGrantError);
    expect(h.store.audit.at(-1)).toMatchObject({
      kind: 'auth_denied',
      error: 'account_not_approved',
    });
  });

  it('narrows the scopes on request but never widens them', async () => {
    const h = harness();
    const { client, tokens } = await h.connect();
    const narrowed = await h.provider.exchangeRefreshToken(client, tokens.refresh_token!, [
      'atrium:read',
    ]);
    expect(narrowed.scope).toBe('atrium:read');
    expect(h.store.tokens.get(hashSecret(narrowed.access_token))!.scopes).toEqual(['atrium:read']);
    expect(
      await rejection(
        h.provider.exchangeRefreshToken(client, narrowed.refresh_token!, [
          'atrium:read',
          'atrium:admin',
        ]),
      ),
    ).toBeInstanceOf(InvalidScopeError);
    // The grant itself keeps its scopes.
    const widened = await h.provider.exchangeRefreshToken(client, narrowed.refresh_token!);
    expect(widened.scope).toBe('atrium:read atrium:write');
  });

  it('caps every expiry at 90 days after the grant was created', async () => {
    const h = harness();
    const { client, tokens } = await h.connect();
    let refresh = tokens.refresh_token!;
    for (const day of [20, 40, 60]) {
      h.clock.now = T0 + day * DAY;
      refresh = (await h.provider.exchangeRefreshToken(client, refresh)).refresh_token!;
      expect(h.store.tokens.get(hashSecret(refresh))!.expiresAt).toBe(h.clock.now + 30 * DAY);
    }
    h.clock.now = T0 + 89 * DAY + 23 * HOUR + 30 * MINUTE;
    const last = await h.provider.exchangeRefreshToken(client, refresh);
    expect(h.store.tokens.get(hashSecret(last.refresh_token!))!.expiresAt).toBe(T0 + 90 * DAY);
    expect(h.store.tokens.get(hashSecret(last.access_token))!.expiresAt).toBe(T0 + 90 * DAY);
    expect(last.expires_in).toBe(30 * 60);
    h.clock.now = T0 + 90 * DAY;
    expect(
      await rejection(h.provider.exchangeRefreshToken(client, last.refresh_token!)),
    ).toBeInstanceOf(InvalidGrantError);
    await expect(h.provider.verifyAccessToken(last.access_token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });
});

describe('verifyAccessToken', () => {
  it('returns the AuthInfo of a live access token', async () => {
    const h = harness();
    const { client, tokens, grantId } = await h.connect();
    h.clock.now = T0 + 59 * MINUTE;
    const info = await h.provider.verifyAccessToken(tokens.access_token);
    expect(info).toEqual({
      token: tokens.access_token,
      clientId: client.client_id,
      scopes: ['atrium:read', 'atrium:write'],
      expiresAt: Math.floor((T0 + HOUR) / 1000),
      resource: new URL(MCP_RESOURCE_URL),
      extra: { uid: UID, grantId },
    });
  });

  it('refuses an expired token, a refresh token, an unknown token and a foreign resource', async () => {
    const h = harness();
    const { tokens } = await h.connect();
    for (const bad of [tokens.refresh_token!, 'atr_nope', '', 'Bearer x']) {
      await expect(h.provider.verifyAccessToken(bad)).rejects.toBeInstanceOf(InvalidTokenError);
    }
    h.store.tokens.get(hashSecret(tokens.access_token))!.resource = 'https://x.example/mcp';
    await expect(h.provider.verifyAccessToken(tokens.access_token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    h.store.tokens.get(hashSecret(tokens.access_token))!.resource = MCP_RESOURCE_URL;
    h.clock.now = T0 + HOUR;
    await expect(h.provider.verifyAccessToken(tokens.access_token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it('refuses a token whose grant was revoked', async () => {
    const h = harness();
    const { client, tokens } = await h.connect();
    await h.provider.revokeToken!(client, { token: tokens.refresh_token! });
    await expect(h.provider.verifyAccessToken(tokens.access_token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it('refuses a blocked or pending account, within 60 seconds on a warm instance', async () => {
    const h = harness();
    const { tokens } = await h.connect();
    await h.provider.verifyAccessToken(tokens.access_token);
    h.store.accounts.set(UID, 'blocked');
    // Cached for up to a minute.
    h.clock.now = T0 + 59 * 1000;
    await h.provider.verifyAccessToken(tokens.access_token);
    h.clock.now = T0 + 60 * 1000;
    await expect(h.provider.verifyAccessToken(tokens.access_token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    h.store.accounts.delete(UID);
    h.clock.now = T0 + 121 * 1000;
    await expect(h.provider.verifyAccessToken(tokens.access_token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });
});

describe('revokeToken', () => {
  it('ends the whole grant for either token of the same client, and ignores the rest', async () => {
    const h = harness();
    const first = await h.connect();
    const second = await h.connect();
    const other = await h.register();
    await h.provider.revokeToken!(other, { token: first.tokens.access_token });
    await h.provider.revokeToken!(first.client, { token: 'atr_unknown' });
    expect(h.store.grants.get(`${UID}/${first.grantId}`)!.revokedAt).toBeNull();

    await h.provider.revokeToken!(first.client, { token: first.tokens.access_token });
    expect(h.store.grants.get(`${UID}/${first.grantId}`)!.revokedAt).toBe(T0);
    expect(h.store.grants.get(`${UID}/${second.grantId}`)!.revokedAt).toBeNull();
    expect(h.store.tokens.size).toBe(2);
    await h.provider.verifyAccessToken(second.tokens.access_token);

    await h.provider.revokeToken!(second.client, { token: second.tokens.refresh_token! });
    expect(h.store.tokens.size).toBe(0);
    expect(h.store.audit.filter((e) => e.kind === 'grant_revoked')).toHaveLength(2);
  });
});
