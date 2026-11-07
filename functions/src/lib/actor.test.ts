import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import { actorFromRequest } from './actor';

function req(token: Record<string, unknown> | null): CallableRequest {
  return {
    data: {},
    auth: token ? { uid: 'u1', token } : undefined,
  } as unknown as CallableRequest;
}

function failure(fn: () => unknown): HttpsError {
  try {
    fn();
  } catch (error) {
    return error as HttpsError;
  }
  throw new Error('expected a throw');
}

const identity = { email: 'avery@example.com', email_verified: true, name: 'Avery Quinn' };

describe('actorFromRequest', () => {
  it('returns the identity, status and claims of an approved caller', () => {
    const actor = actorFromRequest(req({ ...identity, acct: 'approved', admin: true }));
    expect(actor).toMatchObject({
      uid: 'u1',
      email: 'avery@example.com',
      emailVerified: true,
      displayName: 'Avery Quinn',
      photoURL: null,
      accountStatus: 'approved',
    });
    expect(actor.claims.admin).toBe(true);
  });

  it('rejects a signed-out caller as unauthenticated', () => {
    expect(failure(() => actorFromRequest(req(null))).code).toBe('unauthenticated');
  });

  it.each([
    ['pending (no claim)', {}, 'pending'],
    ['pending (unknown claim value)', { acct: 'whatever' }, 'pending'],
    ['blocked', { acct: 'blocked' }, 'blocked'],
  ])('refuses %s by default', (_label, claims, status) => {
    const error = failure(() => actorFromRequest(req({ ...identity, ...claims })));
    expect(error.code).toBe('permission-denied');
    expect(error.message).toBe("Your account can't do this.");
    expect(error.details).toEqual({ reason: 'account-not-approved', status });
  });

  it('honours the allow option', () => {
    const allow = ['approved', 'blocked'] as const;
    expect(actorFromRequest(req({ acct: 'blocked' }), { allow }).accountStatus).toBe('blocked');
    expect(actorFromRequest(req({ acct: 'approved' }), { allow }).accountStatus).toBe('approved');
    const error = failure(() => actorFromRequest(req({}), { allow }));
    expect(error.details).toEqual({ reason: 'account-not-approved', status: 'pending' });
  });

  it('allows every state when asked to', () => {
    const allow = ['approved', 'pending', 'blocked'] as const;
    expect(actorFromRequest(req({}), { allow }).accountStatus).toBe('pending');
  });

  it('an empty allow list refuses everyone', () => {
    expect(() => actorFromRequest(req({ acct: 'approved' }), { allow: [] })).toThrow();
  });
});
