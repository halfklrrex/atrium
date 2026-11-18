import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as StoreModule from '../../../functions/src/api/admin-token-store';
import type * as TokensModule from '../../../functions/src/api/tokens';
import type * as AuthModule from '../../../functions/src/api/auth';
import { createTestEnv } from './helpers';

/**
 * End to end against the Firestore emulator (P8 PR 1): the real `adminApiTokenStore` with the
 * create and revoke logic and the verifier. Checks Timestamp storage, the 10-active limit inside a
 * transaction (also under concurrency), revoke by the uid + tokenId query (no composite index) and
 * the verifier against stored documents. Runs through `pnpm test:rules`.
 */

let env: RulesTestEnvironment;
let admin: typeof AdminModule;
let storeMod: typeof StoreModule;
let tokens: typeof TokensModule;
let auth: typeof AuthModule;

const UID = 'e2e-user';
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  env = await createTestEnv();
  admin = await import('../../../functions/src/lib/admin');
  storeMod = await import('../../../functions/src/api/admin-token-store');
  tokens = await import('../../../functions/src/api/tokens');
  auth = await import('../../../functions/src/api/auth');
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await admin.db().collection('users').doc(UID).set({ accountStatus: 'approved' });
  await admin
    .db()
    .collection('workspaces')
    .doc('w1')
    .set({ roles: { [UID]: 'owner' } });
});

const store = () => storeMod.adminApiTokenStore(admin.db());
const input = (over: Record<string, unknown> = {}) =>
  ({ name: 'E2E', scopes: ['read'], expiresInDays: 90, ...over }) as Parameters<
    typeof tokens.createApiToken
  >[3];
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return 'none';
};
const activeCount = async () =>
  (await admin.db().collection('users').doc(UID).collection('apiTokens').get()).docs.filter(
    (d) => d.get('revokedAt') === null,
  ).length;

describe('createApiToken against Firestore', () => {
  it('stores the token and index documents with Timestamp fields and no secret', async () => {
    const now = Date.now();
    const result = await tokens.createApiToken(
      store(),
      now,
      UID,
      input({ workspaceIds: ['w1'], scopes: ['read', 'write'] }),
    );
    const doc = await admin.db().doc(`users/${UID}/apiTokens/${result.tokenId}`).get();
    expect(doc.get('createdAt')).toBeInstanceOf(Timestamp);
    expect(doc.get('expiresAt').toMillis()).toBe(now + 90 * DAY);
    expect(doc.data()).toMatchObject({
      name: 'E2E',
      prefix: result.token.slice(0, 8),
      scopes: ['read', 'write'],
      workspaceIds: ['w1'],
      lastUsedAt: null,
      revokedAt: null,
    });
    const hash = tokens.hashApiToken(result.token);
    const index = await admin.db().doc(`apiTokenIndex/${hash}`).get();
    expect(index.data()).toMatchObject({ uid: UID, tokenId: result.tokenId });
    expect(index.get('expiresAt')).toBeInstanceOf(Timestamp);
    expect(JSON.stringify([doc.data(), index.data()])).not.toContain(result.token);
  });

  it('refuses an 11th active token; expired and revoked ones do not count', async () => {
    const now = Date.now();
    const made = [];
    for (let i = 0; i < 10; i += 1)
      made.push(await tokens.createApiToken(store(), now, UID, input()));
    expect(await code(tokens.createApiToken(store(), now, UID, input()))).toBe(
      'resource-exhausted',
    );
    await tokens.revokeApiToken(store(), now, UID, { tokenId: made[0]!.tokenId });
    await tokens.createApiToken(store(), now, UID, input());
    expect(await code(tokens.createApiToken(store(), now, UID, input()))).toBe(
      'resource-exhausted',
    );
    // 91 days later every remaining token has expired, so there is room again.
    await tokens.createApiToken(store(), now + 91 * DAY, UID, input());
  });

  it('leaves at most 10 active tokens when two creates race at 9', async () => {
    const now = Date.now();
    for (let i = 0; i < 9; i += 1) await tokens.createApiToken(store(), now, UID, input());
    const results = await Promise.allSettled([
      tokens.createApiToken(store(), now, UID, input()),
      tokens.createApiToken(store(), now, UID, input()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(2);
    expect(await activeCount()).toBeLessThanOrEqual(10);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('refuses a workspace the caller is not in', async () => {
    expect(
      await code(
        tokens.createApiToken(store(), Date.now(), UID, input({ workspaceIds: ['nope'] })),
      ),
    ).toBe('permission-denied');
  });
});

describe('revokeApiToken against Firestore', () => {
  it('sets revokedAt, deletes the index doc by query, and a repeat is a no-op', async () => {
    const now = Date.now();
    const { token, tokenId } = await tokens.createApiToken(store(), now, UID, input());
    expect(await tokens.revokeApiToken(store(), now + 5, UID, { tokenId })).toEqual({
      tokenId,
      revoked: true,
    });
    const doc = await admin.db().doc(`users/${UID}/apiTokens/${tokenId}`).get();
    expect(doc.get('revokedAt').toMillis()).toBe(now + 5);
    expect(
      (
        await admin
          .db()
          .doc(`apiTokenIndex/${tokens.hashApiToken(token)}`)
          .get()
      ).exists,
    ).toBe(false);
    expect(await tokens.revokeApiToken(store(), now + 9, UID, { tokenId })).toEqual({
      tokenId,
      revoked: false,
    });
  });

  it('revokeAllApiTokens ends every token of the account', async () => {
    const now = Date.now();
    await tokens.createApiToken(store(), now, UID, input());
    await tokens.createApiToken(store(), now, UID, input());
    expect(await tokens.revokeAllApiTokens(store(), now, UID)).toBe(2);
    expect((await admin.db().collection('apiTokenIndex').get()).size).toBe(0);
  });
});

describe('verifyApiToken against Firestore', () => {
  const deps = () => ({
    store: store(),
    verifyOAuthToken: () => Promise.reject(new Error('unused')),
  });
  const reason = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      return (error as { reason: string }).reason;
    }
    return 'none';
  };

  it('accepts a valid token and records lastUsedAt', async () => {
    const { token, tokenId } = await tokens.createApiToken(
      store(),
      Date.now(),
      UID,
      input({ workspaceIds: ['w1'] }),
    );
    const info = await auth.verifyApiToken(`Bearer ${token}`, deps());
    expect(info).toEqual({
      uid: UID,
      scopes: ['read'],
      workspaceIds: ['w1'],
      kind: 'pat',
      tokenId,
    });
    const doc = await admin.db().doc(`users/${UID}/apiTokens/${tokenId}`).get();
    expect(doc.get('lastUsedAt')).toBeInstanceOf(Timestamp);
  });

  it('refuses a revoked token', async () => {
    const { token, tokenId } = await tokens.createApiToken(store(), Date.now(), UID, input());
    await tokens.revokeApiToken(store(), Date.now(), UID, { tokenId });
    expect(await reason(auth.verifyApiToken(`Bearer ${token}`, deps()))).toBe('invalid_token');
  });

  it('refuses an expired token', async () => {
    const past = Date.now() - 100 * DAY;
    const { token } = await tokens.createApiToken(store(), past, UID, input({ expiresInDays: 30 }));
    expect(await reason(auth.verifyApiToken(`Bearer ${token}`, deps()))).toBe('expired_token');
  });

  it('refuses a blocked account', async () => {
    const { token } = await tokens.createApiToken(store(), Date.now(), UID, input());
    await admin.db().collection('users').doc(UID).update({ accountStatus: 'blocked' });
    expect(await reason(auth.verifyApiToken(`Bearer ${token}`, deps()))).toBe(
      'account_not_approved',
    );
  });
});
