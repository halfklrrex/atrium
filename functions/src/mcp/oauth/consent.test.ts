import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import { authRequestInfo, authorizeRequest, redirectHostOf } from './consent';
import { revokeAllMcpGrants, revokeMcpGrant } from './grants';
import { CLAUDE_REDIRECT, LOOPBACK_REDIRECT, MINUTE, T0, UID, harness } from './test-helpers';
import { hashSecret } from './tokens';

async function refusal(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError);
    return error as HttpsError;
  }
  throw new Error('expected a refusal');
}

describe('mcpAuthRequestInfo', () => {
  it('describes a pending request, flagging a loopback redirect', async () => {
    const h = harness();
    const client = await h.register([CLAUDE_REDIRECT, LOOPBACK_REDIRECT]);
    const a = await h.startAuth(client, { redirectUri: CLAUDE_REDIRECT });
    expect(await authRequestInfo(h.store, h.clock.now, { requestId: a.requestId })).toEqual({
      clientName: 'Claude',
      redirectHost: 'claude.ai',
      loopback: false,
      requestedScopes: ['atrium:read', 'atrium:write'],
      expiresAt: T0 + 10 * MINUTE,
    });
    const b = await h.startAuth(client, {
      redirectUri: LOOPBACK_REDIRECT,
      scopes: ['atrium:read'],
    });
    expect(await authRequestInfo(h.store, h.clock.now, { requestId: b.requestId })).toMatchObject({
      redirectHost: 'localhost:51234',
      loopback: true,
      requestedScopes: ['atrium:read'],
    });
    expect(redirectHostOf('http://127.0.0.1:9/callback')).toEqual({
      host: '127.0.0.1:9',
      loopback: true,
    });
    expect(redirectHostOf('nope')).toEqual({ host: '', loopback: false });
  });

  it('reads an unknown, expired, approved or denied request as expired (not-found)', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    const info = (id: string) => authRequestInfo(h.store, h.clock.now, { requestId: id });
    expect((await refusal(info('missing'))).code).toBe('not-found');
    h.clock.now = T0 + 10 * MINUTE;
    const expired = await refusal(info(requestId));
    expect(expired.code).toBe('not-found');
    expect(expired.details).toEqual({ reason: 'request-expired' });
    h.clock.now = T0;
    await h.consent(requestId);
    expect((await refusal(info(requestId))).code).toBe('not-found');
    const denied = await h.startAuth(client);
    await authorizeRequest(h.store, T0, UID, { requestId: denied.requestId, decision: 'deny' });
    expect((await refusal(info(denied.requestId))).code).toBe('not-found');
  });
});

describe('mcpAuthorize: allow', () => {
  it('binds the uid and scopes, stores only the code hash, and redirects with code and state', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    const { redirectUrl } = await authorizeRequest(h.store, T0, UID, {
      requestId,
      decision: 'allow',
    });
    const url = new URL(redirectUrl);
    expect(`${url.origin}${url.pathname}`).toBe(CLAUDE_REDIRECT);
    expect(url.searchParams.get('state')).toBe('state-1');
    const code = url.searchParams.get('code')!;
    expect(code.startsWith(`${requestId}.`)).toBe(true);
    expect(h.store.requests.get(requestId)).toMatchObject({
      status: 'approved',
      uid: UID,
      scopes: ['atrium:read', 'atrium:write'],
      codeHash: hashSecret(code),
    });
    expect(h.store.allStoredText()).not.toContain(code.split('.')[1]);
    expect(h.store.audit).toEqual([]);
  });

  it('keeps a chosen subset of the requested scopes, in the requested order', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    await authorizeRequest(h.store, T0, UID, {
      requestId,
      decision: 'allow',
      scopes: ['atrium:read'],
    });
    expect(h.store.requests.get(requestId)!.scopes).toEqual(['atrium:read']);
    const b = await h.startAuth(client);
    await authorizeRequest(h.store, T0, UID, {
      requestId: b.requestId,
      decision: 'allow',
      scopes: ['atrium:write', 'atrium:read'],
    });
    expect(h.store.requests.get(b.requestId)!.scopes).toEqual(['atrium:read', 'atrium:write']);
    const c = await h.startAuth(client, { state: undefined });
    const { redirectUrl } = await authorizeRequest(h.store, T0, UID, {
      requestId: c.requestId,
      decision: 'allow',
    });
    expect(new URL(redirectUrl).searchParams.has('state')).toBe(false);
  });

  it('refuses scopes without atrium:read or beyond the requested ones', async () => {
    const h = harness();
    const client = await h.register();
    const readOnly = await h.startAuth(client, { scopes: ['atrium:read'] });
    const both = await h.startAuth(client);
    const attempt = (requestId: string, scopes: ('atrium:read' | 'atrium:write')[]) =>
      refusal(authorizeRequest(h.store, T0, UID, { requestId, decision: 'allow', scopes }));
    for (const [requestId, scopes] of [
      [both.requestId, ['atrium:write']],
      [both.requestId, []],
      [readOnly.requestId, ['atrium:read', 'atrium:write']],
    ] as const) {
      const error = await attempt(requestId, [...scopes]);
      expect(error.code).toBe('invalid-argument');
      expect(error.details).toEqual({ reason: 'bad-scopes' });
    }
    expect(h.store.requests.get(both.requestId)!.status).toBe('pending');
    expect(h.store.requests.get(readOnly.requestId)!.status).toBe('pending');
  });

  it('refuses an expired, approved, denied or unknown request', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    const allow = (id: string, now = T0) =>
      refusal(authorizeRequest(h.store, now, UID, { requestId: id, decision: 'allow' }));
    const expired = await allow(requestId, T0 + 10 * MINUTE);
    expect(expired.code).toBe('failed-precondition');
    expect(expired.details).toEqual({ reason: 'request-expired' });
    expect((await allow('missing')).code).toBe('failed-precondition');
    await h.consent(requestId);
    expect((await allow(requestId)).code).toBe('failed-precondition');
    const denied = await h.startAuth(client);
    await authorizeRequest(h.store, T0, UID, { requestId: denied.requestId, decision: 'deny' });
    expect((await allow(denied.requestId)).code).toBe('failed-precondition');
  });

  it('refuses an account whose document is not approved, leaving the request pending', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    for (const status of ['pending', 'blocked', undefined] as const) {
      if (status) h.store.accounts.set(UID, status);
      else h.store.accounts.delete(UID);
      const error = await refusal(
        authorizeRequest(h.store, T0, UID, { requestId, decision: 'allow' }),
      );
      expect(error.code).toBe('permission-denied');
      expect(error.details).toEqual({
        reason: 'account-not-approved',
        status: status ?? 'pending',
      });
    }
    expect(h.store.requests.get(requestId)).toMatchObject({ status: 'pending', uid: null });
  });
});

describe('mcpAuthorize: deny', () => {
  it('marks the request denied and redirects with access_denied and the state', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    const { redirectUrl } = await authorizeRequest(h.store, T0, UID, {
      requestId,
      decision: 'deny',
      scopes: ['atrium:read'],
    });
    const url = new URL(redirectUrl);
    expect(`${url.origin}${url.pathname}`).toBe(CLAUDE_REDIRECT);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.has('code')).toBe(false);
    expect(h.store.requests.get(requestId)).toMatchObject({
      status: 'denied',
      uid: UID,
      codeHash: null,
    });
    expect(h.store.audit).toEqual([
      expect.objectContaining({
        kind: 'auth_denied',
        uid: UID,
        clientId: client.client_id,
        error: 'user_denied',
      }),
    ]);
    // Denied is final: the provider refuses any code shaped for it.
    await expect(
      h.provider.exchangeAuthorizationCode(client, `${requestId}.anything`),
    ).rejects.toThrow();
  });

  it('a blocked account can still deny (nothing is granted) but not twice', async () => {
    const h = harness();
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    h.store.accounts.set(UID, 'blocked');
    await authorizeRequest(h.store, T0, UID, { requestId, decision: 'deny' });
    const again = await refusal(
      authorizeRequest(h.store, T0, UID, { requestId, decision: 'deny' }),
    );
    expect(again.code).toBe('failed-precondition');
  });
});

describe('revokeMcpGrant', () => {
  it('revokes one of the caller’s own grants once', async () => {
    const h = harness();
    const { tokens, grantId } = await h.connect();
    const other = await h.connect();
    expect(await revokeMcpGrant(h.store, T0 + MINUTE, UID, { grantId })).toEqual({
      grantId,
      revoked: true,
    });
    expect(h.store.grants.get(`${UID}/${grantId}`)!.revokedAt).toBe(T0 + MINUTE);
    expect(h.store.tokens.has(hashSecret(tokens.access_token))).toBe(false);
    expect(h.store.tokens.has(hashSecret(other.tokens.access_token))).toBe(true);
    expect(await revokeMcpGrant(h.store, T0 + 2 * MINUTE, UID, { grantId })).toEqual({
      grantId,
      revoked: false,
    });
    expect(h.store.grants.get(`${UID}/${grantId}`)!.revokedAt).toBe(T0 + MINUTE);
    expect(h.store.audit.filter((e) => e.kind === 'grant_revoked')).toEqual([
      expect.objectContaining({ uid: UID, grantId, at: T0 + MINUTE }),
    ]);
  });

  it("refuses another person's grant as not found", async () => {
    const h = harness();
    const { grantId } = await h.connect();
    const error = await refusal(revokeMcpGrant(h.store, T0, 'someone-else', { grantId }));
    expect(error.code).toBe('not-found');
    expect(h.store.grants.get(`${UID}/${grantId}`)!.revokedAt).toBeNull();
  });
});

describe('revokeAllMcpGrants', () => {
  it('revokes every active grant of the account and nothing of anyone else', async () => {
    const h = harness();
    const a = await h.connect();
    const b = await h.connect();
    await revokeMcpGrant(h.store, T0, UID, { grantId: b.grantId });
    h.store.accounts.set('u2', 'approved');
    const client = await h.register();
    const { requestId } = await h.startAuth(client);
    const code = await h.consent(requestId, undefined, 'u2');
    await h.provider.exchangeAuthorizationCode(client, code);
    const theirs = [...h.store.grants.keys()].find((key) => key.startsWith('u2/'))!;

    expect(await revokeAllMcpGrants(h.store, T0 + MINUTE, UID)).toBe(1);
    expect(h.store.grants.get(`${UID}/${a.grantId}`)!.revokedAt).toBe(T0 + MINUTE);
    expect(h.store.grants.get(`${UID}/${b.grantId}`)!.revokedAt).toBe(T0);
    expect(h.store.grants.get(theirs)!.revokedAt).toBeNull();
    expect(h.store.tokens.size).toBe(2);
    expect(await revokeAllMcpGrants(h.store, T0 + MINUTE, UID)).toBe(0);
    expect(await revokeAllMcpGrants(h.store, T0 + MINUTE, 'nobody')).toBe(0);
  });
});
