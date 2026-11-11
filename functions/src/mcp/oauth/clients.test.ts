import type { AccountStatus } from '@atrium/shared';
import { InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { describe, expect, it } from 'vitest';
import { AccountStatusCache } from './account-cache';
import { cleanClientName, isAllowedRedirectUri } from './clients';
import { MCP_CLIENT_TTL_MS } from './constants';
import { CLAUDE_REDIRECT, DAY, LOOPBACK_REDIRECT, T0, harness, rejection } from './test-helpers';
import { authCodeRequestId, hashSecret, newAuthCode, newToken, secretMatchesHash } from './tokens';

describe('the redirect allow-list', () => {
  it('accepts the Claude callbacks and loopback /callback on any port', () => {
    for (const uri of [
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
      'http://localhost/callback',
      'http://localhost:3000/callback',
      'http://127.0.0.1:65535/callback',
    ]) {
      expect(isAllowedRedirectUri(uri), uri).toBe(true);
    }
  });

  it('refuses everything else', () => {
    for (const uri of [
      'https://evil.example.com/api/mcp/auth_callback',
      'https://claude.ai.evil.example.com/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/other',
      'https://claude.ai/api/mcp/auth_callback/',
      'https://claude.ai/api/mcp/auth_callback?x=1',
      'https://claude.ai/api/mcp/auth_callback#frag',
      'https://claude.ai:8443/api/mcp/auth_callback',
      'https://user:pw@claude.ai/api/mcp/auth_callback',
      'http://claude.ai/api/mcp/auth_callback',
      'https://localhost:3000/callback',
      'http://localhost:3000/other',
      'http://localhost:3000/callback?x=1',
      'http://[::1]:3000/callback',
      'http://localhost.example.com/callback',
      'atrium://callback',
      'not a url',
      '',
    ]) {
      expect(isAllowedRedirectUri(uri), uri).toBe(false);
    }
  });
});

describe('registerClient', () => {
  it('stores a public client and returns it without a secret', async () => {
    const h = harness();
    const client = await h.provider.clientsStore.registerClient({
      client_id: 'given-by-sdk',
      redirect_uris: [CLAUDE_REDIRECT, LOOPBACK_REDIRECT, CLAUDE_REDIRECT],
      client_name: 'Claude',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'client_credentials'],
      response_types: ['code', 'token'],
      scope: 'everything',
      logo_uri: 'https://claude.ai/logo.png',
    } as never);
    expect(client).toEqual({
      client_id: 'given-by-sdk',
      client_id_issued_at: Math.floor(T0 / 1000),
      client_name: 'Claude',
      redirect_uris: [CLAUDE_REDIRECT, LOOPBACK_REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
    expect(h.store.clients.get('given-by-sdk')).toEqual({
      clientId: 'given-by-sdk',
      clientName: 'Claude',
      redirectUris: [CLAUDE_REDIRECT, LOOPBACK_REDIRECT],
      tokenEndpointAuthMethod: 'none',
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      createdAt: T0,
      lastUsedAt: T0,
      expiresAt: T0 + MCP_CLIENT_TTL_MS,
    });
    expect(h.store.allStoredText()).not.toContain('logo');
    expect(await h.provider.clientsStore.getClient('given-by-sdk')).toEqual(client);
  });

  it('forces public clients: a secret is dropped and a confidential method is forced to none', async () => {
    const h = harness();
    const client = await h.provider.clientsStore.registerClient({
      redirect_uris: [CLAUDE_REDIRECT],
      client_secret: 'shh',
      client_secret_expires_at: 123,
    });
    expect(client).not.toHaveProperty('client_secret');
    expect(client.token_endpoint_auth_method).toBe('none');
    expect(h.store.allStoredText()).not.toContain('shh');
    for (const method of ['client_secret_post', 'client_secret_basic'] as const) {
      const other = await h.provider.clientsStore.registerClient({
        redirect_uris: [CLAUDE_REDIRECT],
        token_endpoint_auth_method: method,
      });
      expect(other.token_endpoint_auth_method).toBe('none');
      expect(other).not.toHaveProperty('client_secret');
    }
  });

  it('refuses a missing or disallowed redirect URI', async () => {
    const h = harness();
    for (const redirect_uris of [
      [],
      ['https://evil.example.com/cb'],
      [CLAUDE_REDIRECT, 'http://x/'],
    ]) {
      expect(
        await rejection(h.provider.clientsStore.registerClient({ redirect_uris })),
      ).toBeInstanceOf(InvalidClientMetadataError);
    }
    expect(h.store.clients.size).toBe(0);
  });

  it('keeps client_name to one clean line of at most 100 characters', async () => {
    expect(cleanClientName(' Claude\u0000 Code\n ')).toBe('Claude  Code');
    expect(cleanClientName('x'.repeat(150))).toHaveLength(100);
    expect(cleanClientName(undefined)).toBe('Unnamed app');
    expect(cleanClientName(42)).toBe('Unnamed app');
    const h = harness();
    const client = await h.provider.clientsStore.registerClient({
      redirect_uris: [CLAUDE_REDIRECT],
      client_name: 'n'.repeat(150),
    });
    expect(client.client_name).toHaveLength(100);
  });

  it('forgets a client that was not used for 90 days', async () => {
    const h = harness();
    const client = await h.register();
    h.clock.now = T0 + 90 * DAY - 1;
    expect(await h.provider.clientsStore.getClient(client.client_id)).toBeDefined();
    h.clock.now = T0 + 90 * DAY;
    expect(await h.provider.clientsStore.getClient(client.client_id)).toBeUndefined();
    expect(await h.provider.clientsStore.getClient('nope')).toBeUndefined();
  });
});

describe('tokens and codes', () => {
  it('look as specified and hash deterministically', () => {
    const token = newToken();
    expect(token).toMatch(/^atr_[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    expect(hashSecret(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(token)).toBe(hashSecret(token));
    expect(hashSecret(token)).not.toContain(token);
    expect(secretMatchesHash(token, hashSecret(token))).toBe(true);
    expect(secretMatchesHash(`${token}x`, hashSecret(token))).toBe(false);
    expect(secretMatchesHash(token, null)).toBe(false);
    expect(secretMatchesHash(token, 'zz')).toBe(false);
  });

  it('codes carry the request id in front of the secret', () => {
    const code = newAuthCode('req_1');
    expect(code).toMatch(/^req_1\.[A-Za-z0-9_-]{43}$/);
    expect(authCodeRequestId(code)).toBe('req_1');
    for (const bad of ['', 'nodot', '.x', 'x.', 'a/b.c', 'a b.c', `${'r'.repeat(129)}.s`]) {
      expect(authCodeRequestId(bad), bad).toBeNull();
    }
  });
});

describe('AccountStatusCache', () => {
  it('caches for the TTL and keeps at most the configured number of accounts', async () => {
    const loads: string[] = [];
    const statuses = new Map<string, AccountStatus>([['a', 'approved']]);
    const clock = { now: T0 };
    const cache = new AccountStatusCache(
      (uid) => {
        loads.push(uid);
        return Promise.resolve(statuses.get(uid) ?? null);
      },
      () => clock.now,
      60_000,
      3,
    );
    expect(await cache.get('a')).toBe('approved');
    statuses.set('a', 'blocked');
    clock.now = T0 + 59_999;
    expect(await cache.get('a')).toBe('approved');
    clock.now = T0 + 60_000;
    expect(await cache.get('a')).toBe('blocked');
    expect(loads).toEqual(['a', 'a']);

    cache.invalidate('a');
    expect(await cache.get('a')).toBe('blocked');
    expect(loads).toHaveLength(3);

    await cache.get('b');
    await cache.get('c');
    await cache.get('d');
    expect(cache.size).toBe(3);
    // `a` was the oldest entry and is loaded again.
    await cache.get('a');
    expect(loads.filter((u) => u === 'a')).toHaveLength(4);
    expect(cache.size).toBe(3);
  });
});
