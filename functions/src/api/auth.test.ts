import { describe, expect, it, vi } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  API_AUTH_CACHE_MAX,
  API_AUTH_CACHE_TTL_MS,
  ApiAuthError,
  ApiTokenVerifier,
  parseBearer,
  verifyApiToken,
  type ApiAuthFailure,
} from './auth';
import { FakeApiTokenStore } from './fake-token-store';
import { createApiToken } from './tokens';

const T0 = Date.parse('2026-11-18T10:00:00.000Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const UID = 'u1';

function setup() {
  const clock = { now: T0 };
  const store = new FakeApiTokenStore();
  store.accounts.set(UID, 'approved');
  store.memberships.set(UID, new Set(['w1', 'w2']));
  const verifyOAuthToken = vi.fn<(token: string) => Promise<AuthInfo>>();
  const verifier = new ApiTokenVerifier({ store, verifyOAuthToken, now: () => clock.now });
  const make = async (
    input: Partial<Parameters<typeof createApiToken>[3]> = {},
    uid = UID,
  ): Promise<{ token: string; tokenId: string }> => {
    const result = await createApiToken(store, clock.now, uid, {
      name: 'Shortcuts',
      scopes: ['read'],
      expiresInDays: 90,
      ...input,
    });
    return { token: result.token, tokenId: result.tokenId };
  };
  return { clock, store, verifier, verifyOAuthToken, make };
}

async function reason(promise: Promise<unknown>): Promise<ApiAuthFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiAuthError);
    expect((error as ApiAuthError).status).toBe(401);
    return (error as ApiAuthError).reason;
  }
  throw new Error('expected an ApiAuthError');
}

describe('parseBearer', () => {
  it('extracts the token', () => {
    expect(parseBearer('Bearer abc')).toBe('abc');
    expect(parseBearer('bearer   abc')).toBe('abc');
    expect(parseBearer('  Bearer abc  ')).toBe('abc');
  });
  it.each([undefined, null, '', '   '])('reports a missing header for %p', (value) => {
    expect(() => parseBearer(value)).toThrowError(
      expect.objectContaining({ reason: 'missing_token' }),
    );
  });
  it.each(['abc', 'Basic abc', 'Bearer', 'Bearer a b', 'Bearer a\tb', `Bearer ${'x'.repeat(513)}`])(
    'reports a malformed header for %p',
    (value) => {
      expect(() => parseBearer(value)).toThrowError(
        expect.objectContaining({ reason: 'malformed_header' }),
      );
    },
  );
});

describe('personal tokens', () => {
  it('accepts a valid token and returns its identity, scopes and restriction', async () => {
    const { verifier, make } = setup();
    const { token, tokenId } = await make({ scopes: ['read', 'write'] });
    expect(await verifier.verify(`Bearer ${token}`)).toEqual({
      uid: UID,
      scopes: ['read', 'write'],
      workspaceIds: null,
      kind: 'pat',
      tokenId,
    });
  });

  it('passes a workspace restriction through', async () => {
    const { verifier, make } = setup();
    const { token } = await make({ workspaceIds: ['w1'] });
    expect((await verifier.verify(`Bearer ${token}`)).workspaceIds).toEqual(['w1']);
  });

  it('rejects an unknown token', async () => {
    const { verifier } = setup();
    expect(await reason(verifier.verify('Bearer atrp_unknown'))).toBe('invalid_token');
  });

  it('rejects a token whose hash is not the one stored (one character off)', async () => {
    const { verifier, make } = setup();
    const { token } = await make();
    const last = token.endsWith('A') ? 'B' : 'A';
    expect(await reason(verifier.verify(`Bearer ${token.slice(0, -1)}${last}`))).toBe(
      'invalid_token',
    );
  });

  it('rejects an expired token', async () => {
    const { verifier, make, clock } = setup();
    const { token } = await make({ expiresInDays: 30 });
    clock.now = T0 + 30 * DAY;
    expect(await reason(verifier.verify(`Bearer ${token}`))).toBe('expired_token');
  });

  it('rejects when the token document says expired even if the index is still there', async () => {
    const { verifier, make, store, clock } = setup();
    const { token, tokenId } = await make();
    store.tokens.get(`${UID}/${tokenId}`)!.expiresAt = clock.now - 1;
    expect(await reason(verifier.verify(`Bearer ${token}`))).toBe('expired_token');
  });

  it('rejects a revoked token (document flag, index left behind)', async () => {
    const { verifier, make, store } = setup();
    const { token, tokenId } = await make();
    store.tokens.get(`${UID}/${tokenId}`)!.revokedAt = T0;
    expect(await reason(verifier.verify(`Bearer ${token}`))).toBe('invalid_token');
  });

  it('rejects a revoked token once the index is deleted', async () => {
    const { verifier, make, store } = setup();
    const { token, tokenId } = await make();
    await store.revokeToken(UID, tokenId, T0);
    expect(await reason(verifier.verify(`Bearer ${token}`))).toBe('invalid_token');
  });

  it.each(['blocked', 'pending'] as const)('rejects a %s account', async (status) => {
    const { verifier, make, store } = setup();
    const { token } = await make();
    store.accounts.set(UID, status);
    expect(await reason(verifier.verify(`Bearer ${token}`))).toBe('account_not_approved');
  });

  it('rejects an account with no status', async () => {
    const { verifier, make, store } = setup();
    const { token } = await make();
    store.accounts.delete(UID);
    expect(await reason(verifier.verify(`Bearer ${token}`))).toBe('account_not_approved');
  });

  it('does not cache failures', async () => {
    const { verifier, make, store } = setup();
    const { token } = await make();
    store.accounts.set(UID, 'pending');
    await reason(verifier.verify(`Bearer ${token}`));
    expect(verifier.cacheSize).toBe(0);
  });
});

describe('cache', () => {
  it('serves a second call from the cache without reading the store', async () => {
    const { verifier, make, store, clock } = setup();
    const { token } = await make();
    await verifier.verify(`Bearer ${token}`);
    const reads = { ...store.reads };
    clock.now += API_AUTH_CACHE_TTL_MS - 1;
    await verifier.verify(`Bearer ${token}`);
    expect(store.reads).toEqual(reads);
  });

  it('re-reads after 60 s, so a revocation bites within a minute', async () => {
    const { verifier, make, store, clock } = setup();
    const { token, tokenId } = await make();
    await verifier.verify(`Bearer ${token}`);
    await store.revokeToken(UID, tokenId, clock.now);
    clock.now += MIN - 1;
    await expect(verifier.verify(`Bearer ${token}`)).resolves.toMatchObject({ uid: UID });
    clock.now += 1;
    expect(await reason(verifier.verify(`Bearer ${token}`))).toBe('invalid_token');
  });

  it('notices a block after the cache window', async () => {
    const { verifier, make, store, clock } = setup();
    const { token } = await make();
    await verifier.verify(`Bearer ${token}`);
    store.accounts.set(UID, 'blocked');
    clock.now += MIN;
    expect(await reason(verifier.verify(`Bearer ${token}`))).toBe('account_not_approved');
  });

  it('never serves a cached token past its own expiry', async () => {
    const { verifier, make, clock } = setup();
    const { token } = await make({ expiresInDays: 30 });
    clock.now = T0 + 30 * DAY - 10_000;
    await verifier.verify(`Bearer ${token}`);
    clock.now = T0 + 30 * DAY;
    expect(await reason(verifier.verify(`Bearer ${token}`))).toBe('expired_token');
  });

  it('invalidate() drops the cache for an account at once', async () => {
    const { verifier, make, store } = setup();
    const { token } = await make();
    await verifier.verify(`Bearer ${token}`);
    store.accounts.set(UID, 'blocked');
    verifier.invalidate(UID);
    expect(await reason(verifier.verify(`Bearer ${token}`))).toBe('account_not_approved');
  });

  it('holds at most 500 entries', async () => {
    const { verifier, store, clock } = setup();
    for (let i = 0; i < API_AUTH_CACHE_MAX + 5; i += 1) {
      const uid = `user${i}`;
      store.accounts.set(uid, 'approved');
      const result = await createApiToken(store, clock.now, uid, {
        name: 't',
        scopes: ['read'],
        expiresInDays: 30,
      });
      await verifier.verify(`Bearer ${result.token}`);
    }
    expect(verifier.cacheSize).toBe(API_AUTH_CACHE_MAX);
  });
});

describe('lastUsedAt', () => {
  it('is written on the first use', async () => {
    const { verifier, make, store } = setup();
    const { token, tokenId } = await make();
    await verifier.verify(`Bearer ${token}`);
    expect(store.touches).toEqual([{ uid: UID, tokenId, now: T0 }]);
  });

  it('is written at most once a minute', async () => {
    const { verifier, make, store, clock } = setup();
    const { token } = await make();
    await verifier.verify(`Bearer ${token}`);
    for (let i = 0; i < 5; i += 1) {
      clock.now += 20_000; // 20 s steps: 100 s in total
      await verifier.verify(`Bearer ${token}`);
    }
    // Writes at t=0 and again once the minute has passed (t=60 s is a cache miss).
    expect(store.touches.map((t) => t.now - T0)).toEqual([0, 60_000]);
  });

  it('skips the write on a forced cache miss inside the minute', async () => {
    const { verifier, make, store, clock } = setup();
    const { token } = await make();
    await verifier.verify(`Bearer ${token}`);
    clock.now += 10_000;
    verifier.invalidate(UID);
    await verifier.verify(`Bearer ${token}`);
    expect(store.touches).toHaveLength(1);
  });

  it('respects a recent write by another instance (the document)', async () => {
    const { verifier, make, store, clock } = setup();
    const { token, tokenId } = await make();
    store.tokens.get(`${UID}/${tokenId}`)!.lastUsedAt = clock.now - 10_000;
    await verifier.verify(`Bearer ${token}`);
    expect(store.touches).toEqual([]);
  });

  it('does not fail the request when the write fails', async () => {
    const { verifier, make, store } = setup();
    const { token } = await make();
    store.failTouch = true;
    await expect(verifier.verify(`Bearer ${token}`)).resolves.toMatchObject({ uid: UID });
  });
});

describe('OAuth access tokens', () => {
  const authInfo = (overrides: Partial<AuthInfo> = {}): AuthInfo => ({
    token: 'atr_x',
    clientId: 'c1',
    scopes: ['atrium:read', 'atrium:write'],
    extra: { uid: UID, grantId: 'g1' },
    ...overrides,
  });

  it('sends non-atrp_ tokens to the OPS4 verifier and maps the scopes', async () => {
    const { verifier, verifyOAuthToken, store } = setup();
    verifyOAuthToken.mockResolvedValue(authInfo());
    expect(await verifier.verify('Bearer atr_abc')).toEqual({
      uid: UID,
      scopes: ['read', 'write'],
      workspaceIds: null,
      kind: 'oauth',
    });
    expect(verifyOAuthToken).toHaveBeenCalledWith('atr_abc');
    expect(store.reads.index).toBe(0);
  });

  it('maps a read-only grant', async () => {
    const { verifier, verifyOAuthToken } = setup();
    verifyOAuthToken.mockResolvedValue(authInfo({ scopes: ['atrium:read', 'other'] }));
    expect((await verifier.verify('Bearer atr_abc')).scopes).toEqual(['read']);
  });

  it('rejects when the OPS4 verifier throws', async () => {
    const { verifier, verifyOAuthToken } = setup();
    verifyOAuthToken.mockRejectedValue(new Error('Invalid token'));
    expect(await reason(verifier.verify('Bearer atr_abc'))).toBe('invalid_token');
  });

  it('rejects an OAuth result without a uid', async () => {
    const { verifier, verifyOAuthToken } = setup();
    verifyOAuthToken.mockResolvedValue(authInfo({ extra: {} }));
    expect(await reason(verifier.verify('Bearer atr_abc'))).toBe('invalid_token');
  });

  it('does not send atrp_ tokens to the OAuth verifier', async () => {
    const { verifier, verifyOAuthToken } = setup();
    await reason(verifier.verify('Bearer atrp_nothing'));
    expect(verifyOAuthToken).not.toHaveBeenCalled();
  });
});

describe('verifyApiToken', () => {
  it('keeps one verifier (and so one cache) per deps object', async () => {
    const { store, make, clock, verifyOAuthToken } = setup();
    const deps = { store, verifyOAuthToken, now: () => clock.now };
    const { token } = await make();
    await verifyApiToken(`Bearer ${token}`, deps);
    const reads = { ...store.reads };
    await verifyApiToken(`Bearer ${token}`, deps);
    expect(store.reads).toEqual(reads);
  });
});
