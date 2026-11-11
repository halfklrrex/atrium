import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as AdminModule from '../../../functions/src/lib/admin';
import type * as StoreModule from '../../../functions/src/mcp/oauth/admin-store';
import type * as ConsentModule from '../../../functions/src/mcp/oauth/consent';
import type * as ConstantsModule from '../../../functions/src/mcp/oauth/constants';
import type * as GrantsModule from '../../../functions/src/mcp/oauth/grants';
import type * as ProviderModule from '../../../functions/src/mcp/oauth/provider';
import type * as TokensModule from '../../../functions/src/mcp/oauth/tokens';

/**
 * End to end against the Firestore emulator (OPS4 PR D): the real OAuth provider over the real
 * Admin SDK store (`functions/src/mcp/oauth/admin-store.ts`), so Firestore's transaction rules
 * (reads before writes), the Timestamp mapping the TTL policies rely on, and the `grantId` query
 * of the revocation path are exercised for real. Runs through `pnpm test:rules`.
 */

let admin: typeof AdminModule;
let stores: typeof StoreModule;
let consent: typeof ConsentModule;
let constants: typeof ConstantsModule;
let grants: typeof GrantsModule;
let providers: typeof ProviderModule;
let tokensModule: typeof TokensModule;

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

beforeAll(async () => {
  process.env.GCLOUD_PROJECT = 'demo-atrium-rules';
  admin = await import('../../../functions/src/lib/admin');
  stores = await import('../../../functions/src/mcp/oauth/admin-store');
  consent = await import('../../../functions/src/mcp/oauth/consent');
  constants = await import('../../../functions/src/mcp/oauth/constants');
  grants = await import('../../../functions/src/mcp/oauth/grants');
  providers = await import('../../../functions/src/mcp/oauth/provider');
  tokensModule = await import('../../../functions/src/mcp/oauth/tokens');
});

async function setup(status: 'approved' | 'blocked' = 'approved') {
  const firestore = admin.db();
  const uid = `mcp-${randomUUID().slice(0, 8)}`;
  await firestore.collection('users').doc(uid).set({ displayName: 'Avery', accountStatus: status });
  const store = stores.adminMcpStore(firestore);
  const clock = { now: Date.now() };
  const provider = new providers.AtriumOAuthProvider(store, { now: () => clock.now });
  const client = await provider.clientsStore.registerClient({
    redirect_uris: [REDIRECT],
    client_name: 'Claude',
    token_endpoint_auth_method: 'none',
  });
  const redirects: string[] = [];
  await provider.authorize(
    client,
    {
      redirectUri: REDIRECT,
      codeChallenge: 'challenge',
      state: 's',
      scopes: ['atrium:read', 'atrium:write'],
      resource: new URL(constants.MCP_RESOURCE_URL),
    },
    { redirect: (url) => redirects.push(url) },
  );
  const requestId = new URL(redirects[0]!).searchParams.get('request')!;
  return { firestore, uid, store, clock, provider, client, requestId };
}

describe('the OAuth provider against the emulator', () => {
  it('runs the whole flow: consent, exchange, verify, refresh, reuse detection, revoke', async () => {
    const { firestore, uid, store, clock, provider, client, requestId } = await setup();

    const { redirectUrl } = await consent.authorizeRequest(store, clock.now, uid, {
      requestId,
      decision: 'allow',
      scopes: ['atrium:read'],
    });
    const code = new URL(redirectUrl).searchParams.get('code')!;
    expect(await provider.challengeForAuthorizationCode(client, code)).toBe('challenge');

    const tokens = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT);
    expect(tokens.scope).toBe('atrium:read');
    const info = await provider.verifyAccessToken(tokens.access_token);
    expect(info.extra).toEqual({ uid, grantId: expect.any(String) });
    const grantId = info.extra!.grantId as string;

    // Stored as Timestamps (the TTL policies read `expiresAt`), hashes only, no raw secrets.
    const requestSnap = await firestore.collection('mcpAuthRequests').doc(requestId).get();
    expect(requestSnap.get('status')).toBe('exchanged');
    expect(requestSnap.get('grantId')).toBe(grantId);
    expect(requestSnap.get('expiresAt').toMillis()).toBe(clock.now + 10 * 60 * 1000);
    expect(JSON.stringify(requestSnap.data())).not.toContain(code.split('.')[1]);
    const grantSnap = await firestore
      .collection('users')
      .doc(uid)
      .collection('mcpGrants')
      .doc(grantId)
      .get();
    expect(grantSnap.data()).toMatchObject({
      clientId: client.client_id,
      clientName: 'Claude',
      redirectHost: 'claude.ai',
      scopes: ['atrium:read'],
      lastRefreshAt: null,
      revokedAt: null,
    });
    expect(grantSnap.get('createdAt').toMillis()).toBe(clock.now);
    const tokenDocs = await firestore.collection('mcpTokens').where('grantId', '==', grantId).get();
    expect(tokenDocs.size).toBe(2);
    for (const snap of tokenDocs.docs) {
      expect(snap.id).toMatch(/^[0-9a-f]{64}$/);
      expect(snap.get('expiresAt').toMillis()).toBeGreaterThan(clock.now);
      expect(JSON.stringify(snap.data())).not.toContain('atr_');
    }

    // Refresh rotates; the old refresh token is marked used and then detected.
    clock.now += 60 * 1000;
    const next = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
    expect(next.access_token).not.toBe(tokens.access_token);
    await provider.verifyAccessToken(next.access_token);
    await expect(provider.exchangeRefreshToken(client, tokens.refresh_token!)).rejects.toThrow(
      /already used/,
    );
    await expect(provider.verifyAccessToken(next.access_token)).rejects.toThrow();
    expect((await store.getGrant(uid, grantId))!.revokedAt).toBe(clock.now);
    expect(
      (await firestore.collection('mcpTokens').where('grantId', '==', grantId).get()).size,
    ).toBe(0);

    const audit = await firestore
      .collection('system')
      .doc('mcpAudit')
      .collection('entries')
      .where('uid', '==', uid)
      .get();
    expect(audit.docs.map((d) => d.get('kind')).sort()).toEqual([
      'auth_denied',
      'grant_created',
      'grant_revoked',
      'token_refreshed',
    ]);
    for (const snap of audit.docs) {
      expect(snap.get('expiresAt').toMillis()).toBeGreaterThan(clock.now);
    }
  });

  it('a replayed code revokes the grant, and the Disconnect path revokes one grant only', async () => {
    const { uid, store, clock, provider, client, requestId } = await setup();
    const code = new URL(
      (await consent.authorizeRequest(store, clock.now, uid, { requestId, decision: 'allow' }))
        .redirectUrl,
    ).searchParams.get('code')!;
    const tokens = await provider.exchangeAuthorizationCode(client, code);
    const grantId = (await provider.verifyAccessToken(tokens.access_token)).extra!
      .grantId as string;
    await expect(provider.exchangeAuthorizationCode(client, code)).rejects.toThrow(/already used/);
    expect((await store.getGrant(uid, grantId))!.revokedAt).toBe(clock.now);
    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow();

    // A second connection, then Disconnect and the admin block path.
    const second = await setup();
    second.clock.now = clock.now;
    const code2 = new URL(
      (
        await consent.authorizeRequest(second.store, clock.now, second.uid, {
          requestId: second.requestId,
          decision: 'allow',
        })
      ).redirectUrl,
    ).searchParams.get('code')!;
    const tokens2 = await second.provider.exchangeAuthorizationCode(second.client, code2);
    const grantId2 = (await second.provider.verifyAccessToken(tokens2.access_token)).extra!
      .grantId as string;
    expect(
      await grants.revokeMcpGrant(second.store, clock.now, second.uid, { grantId: grantId2 }),
    ).toEqual({
      grantId: grantId2,
      revoked: true,
    });
    await expect(second.provider.verifyAccessToken(tokens2.access_token)).rejects.toThrow();
    expect(await grants.revokeAllMcpGrants(second.store, clock.now, second.uid)).toBe(0);
    expect(await store.listActiveGrants(uid)).toEqual([]);
  });

  it('refuses the consent and the exchange for a blocked account', async () => {
    const { uid, store, clock, provider, client, requestId } = await setup('blocked');
    await expect(
      consent.authorizeRequest(store, clock.now, uid, { requestId, decision: 'allow' }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    // Force the request through as if the account had been approved at consent time.
    await store.runTransaction(async (tx) => {
      tx.updateAuthRequest(requestId, {
        status: 'approved',
        uid,
        scopes: ['atrium:read'],
        codeHash: tokensModule.hashSecret(`${requestId}.x`),
      });
    });
    await expect(provider.exchangeAuthorizationCode(client, `${requestId}.x`)).rejects.toThrow(
      /not approved/,
    );
    expect(await store.listActiveGrants(uid)).toEqual([]);
  });
});
