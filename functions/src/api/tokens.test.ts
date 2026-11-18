import { describe, expect, it } from 'vitest';
import { API_TOKEN_MAX_ACTIVE } from '@atrium/shared';
import { FakeApiTokenStore } from './fake-token-store';
import { createApiToken, hashApiToken, revokeAllApiTokens, revokeApiToken } from './tokens';

const T0 = Date.parse('2026-11-18T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const UID = 'u1';

const base = { name: 'Shortcuts', scopes: ['read'] as const, expiresInDays: 90 as const };
const input = (over: Record<string, unknown> = {}) =>
  ({ ...base, scopes: [...base.scopes], ...over }) as Parameters<typeof createApiToken>[3];

function setup() {
  const store = new FakeApiTokenStore();
  store.memberships.set(UID, new Set(['w1', 'w2']));
  return store;
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'none';
}

describe('createApiToken', () => {
  it('returns the token once and stores only its hash', async () => {
    const store = setup();
    const result = await createApiToken(store, T0, UID, input());
    expect(result.token).toMatch(/^atrp_[A-Za-z0-9_-]{43}$/);
    expect(result.prefix).toBe(result.token.slice(0, 8));
    expect(result.expiresAt).toBe(T0 + 90 * DAY);
    const stored = JSON.stringify([...store.tokens.values(), ...store.index.entries()]);
    expect(stored).not.toContain(result.token);
    expect(store.index.get(hashApiToken(result.token))).toEqual({
      uid: UID,
      tokenId: result.tokenId,
      expiresAt: T0 + 90 * DAY,
    });
    expect(store.tokens.get(`${UID}/${result.tokenId}`)).toEqual({
      name: 'Shortcuts',
      prefix: result.prefix,
      scopes: ['read'],
      workspaceIds: null,
      createdAt: T0,
      expiresAt: T0 + 90 * DAY,
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  it('makes a different token every time', async () => {
    const store = setup();
    const a = await createApiToken(store, T0, UID, input());
    const b = await createApiToken(store, T0, UID, input());
    expect(a.token).not.toBe(b.token);
  });

  it.each([30, 90, 365])('sets the expiry for %i days', async (days) => {
    const result = await createApiToken(setup(), T0, UID, input({ expiresInDays: days }));
    expect(result.expiresAt).toBe(T0 + days * DAY);
  });

  it('stores a workspace restriction when the caller is a member of each', async () => {
    const store = setup();
    const result = await createApiToken(
      store,
      T0,
      UID,
      input({ workspaceIds: ['w1', 'w2', 'w1'] }),
    );
    expect(store.tokens.get(`${UID}/${result.tokenId}`)!.workspaceIds).toEqual(['w1', 'w2']);
  });

  it('treats an empty restriction as none', async () => {
    const store = setup();
    const result = await createApiToken(store, T0, UID, input({ workspaceIds: [] }));
    expect(store.tokens.get(`${UID}/${result.tokenId}`)!.workspaceIds).toBeNull();
  });

  it('refuses a workspace the caller is not a member of, and stores nothing', async () => {
    const store = setup();
    expect(await code(createApiToken(store, T0, UID, input({ workspaceIds: ['w1', 'w9'] })))).toBe(
      'permission-denied',
    );
    expect(store.tokens.size).toBe(0);
    expect(store.index.size).toBe(0);
  });

  it(`allows ${API_TOKEN_MAX_ACTIVE} active tokens and refuses the next`, async () => {
    const store = setup();
    for (let i = 0; i < API_TOKEN_MAX_ACTIVE; i += 1) await createApiToken(store, T0, UID, input());
    expect(await code(createApiToken(store, T0, UID, input()))).toBe('resource-exhausted');
    expect(store.tokens.size).toBe(API_TOKEN_MAX_ACTIVE);
  });

  it('does not count revoked or expired tokens, nor other people', async () => {
    const store = setup();
    await createApiToken(store, T0, UID, input({ expiresInDays: 30 }));
    const ninety: string[] = [];
    for (let i = 0; i < API_TOKEN_MAX_ACTIVE - 1; i += 1) {
      ninety.push((await createApiToken(store, T0, UID, input())).tokenId);
    }
    await createApiToken(store, T0, 'u2', input());
    expect(await code(createApiToken(store, T0, UID, input()))).toBe('resource-exhausted');
    // The 30-day token expires: room for one more.
    const later = T0 + 31 * DAY;
    await createApiToken(store, later, UID, input());
    expect(await code(createApiToken(store, later, UID, input()))).toBe('resource-exhausted');
    // A revoked one frees a slot too.
    await revokeApiToken(store, later, UID, { tokenId: ninety[0]! });
    await createApiToken(store, later, UID, input());
  });
});

describe('revokeApiToken', () => {
  it('marks the token revoked and deletes the index document', async () => {
    const store = setup();
    const { token, tokenId } = await createApiToken(store, T0, UID, input());
    expect(await revokeApiToken(store, T0 + 5, UID, { tokenId })).toEqual({
      tokenId,
      revoked: true,
    });
    expect(store.tokens.get(`${UID}/${tokenId}`)!.revokedAt).toBe(T0 + 5);
    expect(store.index.has(hashApiToken(token))).toBe(false);
  });

  it('is a no-op the second time', async () => {
    const store = setup();
    const { tokenId } = await createApiToken(store, T0, UID, input());
    await revokeApiToken(store, T0, UID, { tokenId });
    expect(await revokeApiToken(store, T0 + 9, UID, { tokenId })).toEqual({
      tokenId,
      revoked: false,
    });
    expect(store.tokens.get(`${UID}/${tokenId}`)!.revokedAt).toBe(T0);
  });

  it("cannot reach another person's token", async () => {
    const store = setup();
    const { tokenId } = await createApiToken(store, T0, UID, input());
    expect(await code(revokeApiToken(store, T0, 'u2', { tokenId }))).toBe('not-found');
    expect(store.tokens.get(`${UID}/${tokenId}`)!.revokedAt).toBeNull();
  });

  it('reports an unknown id', async () => {
    expect(await code(revokeApiToken(setup(), T0, UID, { tokenId: 'nope' }))).toBe('not-found');
  });
});

describe('revokeAllApiTokens', () => {
  it('revokes every token of one account and no others', async () => {
    const store = setup();
    const a = await createApiToken(store, T0, UID, input());
    await createApiToken(store, T0, UID, input());
    const other = await createApiToken(store, T0, 'u2', input());
    expect(await revokeAllApiTokens(store, T0 + 1, UID)).toBe(2);
    expect(store.tokens.get(`${UID}/${a.tokenId}`)!.revokedAt).toBe(T0 + 1);
    expect(store.tokens.get(`u2/${other.tokenId}`)!.revokedAt).toBeNull();
    expect(store.index.size).toBe(1);
    expect(await revokeAllApiTokens(store, T0 + 2, UID)).toBe(0);
  });
});
