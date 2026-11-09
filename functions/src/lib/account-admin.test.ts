import type { AccountStatus } from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import {
  afterUserCreated,
  assertAdminToken,
  healApprovedClaim,
  listAccounts,
  setAccountStatus,
  type AccountAuditEntry,
  type AccountAuth,
  type AccountStore,
  type AuthAccount,
} from './account-admin';
import type { NewNotification } from './notifications';

const account = (uid: string, over: Partial<AuthAccount> = {}): AuthAccount => ({
  uid,
  displayName: `User ${uid}`,
  email: `${uid}@example.com`,
  photoURL: null,
  disabled: false,
  claims: {},
  createdAt: '2026-11-01T00:00:00.000Z',
  lastSignInAt: null,
  ...over,
});

class FakeAuth implements AccountAuth {
  /** Shared with the store: every mutating call in order, across both fakes. */
  order: string[] = [];
  users = new Map<string, AuthAccount>();
  calls: string[] = [];
  constructor(...accounts: AuthAccount[]) {
    for (const a of accounts) this.users.set(a.uid, a);
  }
  getUser(uid: string) {
    return Promise.resolve(this.users.get(uid) ?? null);
  }
  setClaims(uid: string, claims: Record<string, unknown>) {
    this.calls.push(`claims:${uid}`);
    this.order.push(`claims:${uid}`);
    this.users.get(uid)!.claims = claims;
    return Promise.resolve();
  }
  revokeRefreshTokens(uid: string) {
    this.calls.push(`revoke:${uid}`);
    this.order.push(`revoke:${uid}`);
    return Promise.resolve();
  }
  setDisabled(uid: string, disabled: boolean) {
    this.calls.push(`disabled:${uid}:${disabled}`);
    this.order.push(`disabled:${uid}:${disabled}`);
    this.users.get(uid)!.disabled = disabled;
    return Promise.resolve();
  }
  listUsers(pageSize: number, pageToken?: string) {
    const all = [...this.users.values()];
    const start = pageToken ? Number(pageToken) : 0;
    const users = all.slice(start, start + pageSize);
    const next = start + pageSize < all.length ? String(start + pageSize) : null;
    return Promise.resolve({ users, nextPageToken: next });
  }
  listAdminUids() {
    return Promise.resolve(
      [...this.users.values()].filter((u) => u.claims.admin === true).map((u) => u.uid),
    );
  }
}

class FakeStore implements AccountStore {
  order: string[] = [];
  failOnStatusWrite = false;
  statuses = new Map<string, AccountStatus>();
  workspaces: string[] = [];
  audit: AccountAuditEntry[] = [];
  notes: Array<{ uid: string; id: string; data: NewNotification }> = [];
  getAccountStatuses(uids: ReadonlyArray<string>) {
    const out = new Map<string, AccountStatus>();
    for (const uid of uids) {
      const s = this.statuses.get(uid);
      if (s) out.set(uid, s);
    }
    return Promise.resolve(out);
  }
  ensurePersonalWorkspace(identity: { uid: string }) {
    if (!this.workspaces.includes(identity.uid)) this.workspaces.push(identity.uid);
    return Promise.resolve(`ws-${identity.uid}`);
  }
  setAccountStatus(uid: string, status: AccountStatus) {
    if (this.failOnStatusWrite) return Promise.reject(new Error('write failed'));
    this.order.push(`doc:${uid}:${status}`);
    this.statuses.set(uid, status);
    return Promise.resolve();
  }
  appendAudit(entry: AccountAuditEntry) {
    this.order.push(`audit:${entry.action}`);
    this.audit.push(entry);
    return Promise.resolve();
  }
  closedAppeals: string[] = [];
  failCloseAppeals = false;
  closeOpenAppeals(uid: string) {
    this.order.push(`appeals:${uid}`);
    if (this.failCloseAppeals) return Promise.reject(new Error('appeals failed'));
    this.closedAppeals.push(uid);
    return Promise.resolve(1);
  }
  deletedTokens: string[] = [];
  failDeleteTokens = false;
  deletePushTokens(uid: string) {
    if (this.failDeleteTokens) return Promise.reject(new Error('tokens failed'));
    this.deletedTokens.push(uid);
    return Promise.resolve();
  }
  createNotification(uid: string, id: string, data: NewNotification) {
    if (this.notes.some((n) => n.uid === uid && n.id === id)) return Promise.resolve(false);
    this.notes.push({ uid, id, data });
    return Promise.resolve(true);
  }
}

const admin = { uid: 'a1', displayName: 'Avery Quinn' };
const adminAccount = () => account('a1', { claims: { acct: 'approved', admin: true } });

function setup(...extra: AuthAccount[]) {
  const auth = new FakeAuth(adminAccount(), ...extra);
  const store = new FakeStore();
  store.order = auth.order;
  return { auth, store, deps: { auth, store } };
}

async function refusal(promise: Promise<unknown>): Promise<HttpsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError);
    return error as HttpsError;
  }
  throw new Error('expected a refusal');
}

describe('assertAdminToken', () => {
  it('only accepts admin: true in the token', () => {
    expect(() => assertAdminToken({ admin: true })).not.toThrow();
    for (const token of [{}, null, undefined, { admin: 'true' }, { acct: 'approved' }]) {
      expect(() => assertAdminToken(token)).toThrow(HttpsError);
    }
  });
});

describe('setAccountStatus: approve', () => {
  it('sets the claim (keeping others), the doc, the workspace, and notifies the person', async () => {
    const { auth, store, deps } = setup(account('u1', { claims: { custom: 1 } }));
    const result = await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    expect(result).toEqual({ uid: 'u1', status: 'approved', changed: true });
    expect(auth.users.get('u1')!.claims).toEqual({ custom: 1, acct: 'approved' });
    expect(store.statuses.get('u1')).toBe('approved');
    expect(store.workspaces).toEqual(['u1']);
    expect(store.audit).toEqual([
      { actorUid: 'a1', targetUid: 'u1', action: 'approve', from: 'pending', to: 'approved' },
    ]);
    expect(store.notes).toHaveLength(1);
    expect(store.notes[0]).toMatchObject({
      uid: 'u1',
      data: { kind: 'account_approved', actorId: 'a1', workspaceId: 'ws-u1' },
    });
  });

  it('the claim is written last', async () => {
    const { auth, deps } = setup(account('u1'));
    await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    expect(auth.calls.at(-1)).toBe('claims:u1');
  });

  it('a second approve is a no-op: nothing is written again', async () => {
    const { auth, store, deps } = setup(account('u1'));
    await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    const calls = [...auth.calls];
    const result = await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    expect(result.changed).toBe(false);
    expect(auth.calls).toEqual(calls);
    expect(store.audit).toHaveLength(1);
    expect(store.notes).toHaveLength(1);
    expect(store.workspaces).toHaveLength(1);
  });

  it('does not keep the workspace creation from running for an unknown uid', async () => {
    const { store, deps } = setup();
    const error = await refusal(setAccountStatus(deps, admin, { uid: 'nope', status: 'approved' }));
    expect(error.code).toBe('not-found');
    expect(store.workspaces).toEqual([]);
    expect(store.audit).toEqual([]);
  });
});

describe('setAccountStatus: block and unblock', () => {
  it('blocks in order: claims, revoke, user document, audit; the Auth user is not disabled', async () => {
    const { auth, store, deps } = setup(account('u1', { claims: { acct: 'approved', x: 1 } }));
    store.statuses.set('u1', 'approved');
    auth.order.length = 0;
    const result = await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    expect(result.changed).toBe(true);
    expect(auth.order).toEqual(['claims:u1', 'revoke:u1', 'doc:u1:blocked', 'audit:block']);
    expect(auth.calls.some((c) => c.startsWith('disabled:'))).toBe(false);
    expect(auth.users.get('u1')!.claims).toEqual({ x: 1, acct: 'blocked' });
    expect(auth.users.get('u1')!.disabled).toBe(false);
    expect(store.statuses.get('u1')).toBe('blocked');
    expect(store.audit[0]).toMatchObject({ action: 'block', from: 'approved', to: 'blocked' });
  });

  it('deletes the push tokens of a blocked account, and a failure never fails the block', async () => {
    const { store, deps } = setup(account('u1', { claims: { acct: 'approved' } }));
    await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    expect(store.deletedTokens).toEqual(['u1']);
    const second = setup(account('u2', { claims: { acct: 'approved' } }));
    second.store.failDeleteTokens = true;
    const result = await setAccountStatus(second.deps, admin, { uid: 'u2', status: 'blocked' });
    expect(result.changed).toBe(true);
    expect(second.store.statuses.get('u2')).toBe('blocked');
    expect(second.store.audit).toHaveLength(1);
  });

  it('never touches disabled on block, even for an account disabled in the console', async () => {
    const { auth, deps } = setup(account('u1', { disabled: true, claims: { acct: 'approved' } }));
    await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    expect(auth.calls.some((c) => c.startsWith('disabled:'))).toBe(false);
    expect(auth.users.get('u1')!.disabled).toBe(true);
  });

  it('a failing document write leaves the claim and revoke done and no audit entry', async () => {
    const { auth, store, deps } = setup(account('u1', { claims: { acct: 'approved' } }));
    store.statuses.set('u1', 'approved');
    store.failOnStatusWrite = true;
    await expect(setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' })).rejects.toThrow(
      'write failed',
    );
    expect(auth.users.get('u1')!.claims).toEqual({ acct: 'blocked' });
    expect(store.audit).toEqual([]);
    // The retry is not a no-op: the document still says approved.
    store.failOnStatusWrite = false;
    const retry = await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    expect(retry.changed).toBe(true);
    expect(store.statuses.get('u1')).toBe('blocked');
  });

  it('blocking a second admin removes their admin claim', async () => {
    const { auth, deps } = setup(account('a2', { claims: { acct: 'approved', admin: true } }));
    await setAccountStatus(deps, admin, { uid: 'a2', status: 'blocked' });
    expect(auth.users.get('a2')!.claims).toEqual({ acct: 'blocked' });
  });

  it('a second block is a no-op', async () => {
    const { auth, store, deps } = setup(account('u1', { claims: { acct: 'approved' } }));
    await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    expect(store.statuses.get('u1')).toBe('blocked');
    const calls = [...auth.calls];
    const result = await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    expect(result.changed).toBe(false);
    expect(auth.calls).toEqual(calls);
    expect(store.audit).toHaveLength(1);
  });

  it('finishes a half-done block on retry (claim blocked, document still approved)', async () => {
    const { auth, store, deps } = setup(account('u1', { claims: { acct: 'blocked' } }));
    store.statuses.set('u1', 'approved');
    const result = await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    expect(result.changed).toBe(true);
    expect(store.statuses.get('u1')).toBe('blocked');
    expect(auth.calls.some((c) => c.startsWith('disabled:'))).toBe(false);
  });

  it('is not a no-op when the document has no status, even if the claim agrees', async () => {
    const { store, deps } = setup(account('u1', { claims: { acct: 'blocked' } }));
    const result = await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    expect(result.changed).toBe(true);
    expect(store.statuses.get('u1')).toBe('blocked');
  });

  it('is not a no-op when the document says blocked but the claim is still approved', async () => {
    const { auth, store, deps } = setup(account('u1', { claims: { acct: 'approved' } }));
    store.statuses.set('u1', 'blocked');
    const result = await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    expect(result.changed).toBe(true);
    expect(auth.users.get('u1')!.claims).toEqual({ acct: 'blocked' });
  });

  it('is a no-op only when claim, document and target all agree (approved too)', async () => {
    const { auth, store, deps } = setup(account('u1', { claims: { acct: 'approved' } }));
    store.statuses.set('u1', 'approved');
    const result = await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    expect(result.changed).toBe(false);
    expect(auth.calls).toEqual([]);
    expect(store.audit).toEqual([]);
  });

  it('unblock of a signed-in blocked person (not disabled) does not call setDisabled', async () => {
    const { auth, store, deps } = setup(account('u1', { claims: { acct: 'blocked' } }));
    store.statuses.set('u1', 'blocked');
    await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    expect(auth.calls).toEqual(['claims:u1']);
    expect(auth.order.at(-3)).toBe('claims:u1');
    expect(auth.users.get('u1')!.claims).toEqual({ acct: 'approved' });
  });

  it('unblocks: re-enables a legacy-disabled user and sets approved', async () => {
    const { auth, store, deps } = setup(
      account('u1', { disabled: true, claims: { acct: 'blocked' } }),
    );
    const result = await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    expect(result.changed).toBe(true);
    expect(auth.users.get('u1')!.disabled).toBe(false);
    expect(auth.users.get('u1')!.claims).toEqual({ acct: 'approved' });
    expect(store.audit[0]).toMatchObject({ action: 'unblock', from: 'blocked', to: 'approved' });
    expect(store.notes).toHaveLength(0);
  });

  it('approve and unblock close the open appeals after the claim', async () => {
    const { auth, store, deps } = setup(account('u1', { claims: { acct: 'blocked' } }));
    store.statuses.set('u1', 'blocked');
    await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    expect(store.closedAppeals).toEqual(['u1']);
    const order = auth.order;
    expect(order.indexOf('claims:u1')).toBeLessThan(order.indexOf('appeals:u1'));
  });

  it('a failing appeal close is logged and never fails the unblock', async () => {
    const { auth, store, deps } = setup(account('u1', { claims: { acct: 'blocked' } }));
    store.statuses.set('u1', 'blocked');
    store.failCloseAppeals = true;
    const result = await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    expect(result).toEqual({ uid: 'u1', status: 'approved', changed: true });
    expect(auth.users.get('u1')!.claims).toEqual({ acct: 'approved' });
    expect(store.audit[0]).toMatchObject({ action: 'unblock' });
  });

  it('blocking never closes appeals, nor does a repeated block', async () => {
    const { store, deps } = setup(account('u1', { claims: { acct: 'approved' } }));
    store.statuses.set('u1', 'approved');
    await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    await setAccountStatus(deps, admin, { uid: 'u1', status: 'blocked' });
    expect(store.closedAppeals).toEqual([]);
  });

  it('pressing Unblock again repairs a failed appeal close', async () => {
    const { store, deps } = setup(account('u1', { claims: { acct: 'blocked' } }));
    store.statuses.set('u1', 'blocked');
    store.failCloseAppeals = true;
    const first = await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    expect(first.changed).toBe(true);
    expect(store.closedAppeals).toEqual([]);
    store.failCloseAppeals = false;
    const retry = await setAccountStatus(deps, admin, { uid: 'u1', status: 'approved' });
    expect(retry.changed).toBe(false);
    expect(store.closedAppeals).toEqual(['u1']);
    expect(store.audit).toHaveLength(1);
  });

  it('refuses blocking yourself', async () => {
    const { auth, deps } = setup();
    const error = await refusal(setAccountStatus(deps, admin, { uid: 'a1', status: 'blocked' }));
    expect(error.code).toBe('failed-precondition');
    expect(auth.calls).toEqual([]);
  });

  it('refuses blocking the last admin', async () => {
    // The caller's own admin claim is stale here: Auth lists only the target as an admin.
    const target = account('a2', { claims: { acct: 'approved', admin: true } });
    const auth = new FakeAuth(account('a1', { claims: { acct: 'approved' } }), target);
    const store = new FakeStore();
    const error = await refusal(
      setAccountStatus({ auth, store }, admin, { uid: 'a2', status: 'blocked' }),
    );
    expect(error.code).toBe('failed-precondition');
    expect(auth.calls).toEqual([]);
    expect(store.audit).toEqual([]);
  });
});

describe('listAccounts', () => {
  it('merges the doc status with Auth, falling back to the claim, and pages', async () => {
    const { store, deps } = setup(
      account('p1'),
      account('c1', { claims: { acct: 'approved' } }),
      account('d1', { claims: { acct: 'approved' } }),
      account('b1', { claims: { acct: 'blocked' } }),
    );
    store.statuses.set('d1', 'pending');
    const first = await listAccounts(deps, { pageSize: 3 });
    expect(first.nextPageToken).toBe('3');
    expect(first.accounts.map((a) => [a.uid, a.status])).toEqual([
      ['a1', 'approved'],
      ['p1', 'pending'],
      ['c1', 'approved'],
    ]);
    const second = await listAccounts(deps, { pageSize: 3, pageToken: first.nextPageToken! });
    expect(second.nextPageToken).toBeNull();
    expect(second.accounts.map((a) => [a.uid, a.status])).toEqual([
      ['d1', 'pending'],
      ['b1', 'blocked'],
    ]);
    expect(Object.keys(first.accounts[0]!).sort()).toEqual(
      ['createdAt', 'displayName', 'email', 'lastSignInAt', 'photoURL', 'status', 'uid'].sort(),
    );
  });
});

describe('afterUserCreated (bootstrapUser side effects)', () => {
  const identity = {
    uid: 'n1',
    displayName: 'Casey Lee',
    email: 'casey@example.com',
    photoURL: null,
  };

  it('flag off: sets the approved claim and keeps other claims', async () => {
    const auth = new FakeAuth(account('n1', { claims: { custom: true } }), adminAccount());
    const store = new FakeStore();
    await afterUserCreated(
      { auth, createNotification: store.createNotification.bind(store) },
      identity,
      false,
    );
    expect(auth.users.get('n1')!.claims).toEqual({ custom: true, acct: 'approved' });
    expect(store.notes).toEqual([]);
  });

  it('flag on: no claim, one account_request per admin', async () => {
    const auth = new FakeAuth(
      account('n1'),
      adminAccount(),
      account('a2', { claims: { acct: 'approved', admin: true } }),
    );
    const store = new FakeStore();
    const deps = { auth, createNotification: store.createNotification.bind(store) };
    await afterUserCreated(deps, identity, true);
    expect(auth.users.get('n1')!.claims).toEqual({});
    expect(store.notes.map((n) => n.uid).sort()).toEqual(['a1', 'a2']);
    expect(store.notes[0]!.data).toMatchObject({
      kind: 'account_request',
      actorId: 'n1',
      actorName: 'Casey Lee',
      itemId: 'n1',
    });
    // A retry leaves the existing notices alone.
    await afterUserCreated(deps, identity, true);
    expect(store.notes).toHaveLength(2);
  });
});

describe('healApprovedClaim (ADMIN-1b self-heal on sign-in)', () => {
  it('sets acct: approved on an approved profile that lacks the claim, keeping other claims', async () => {
    const auth = new FakeAuth(account('h1', { claims: { admin: true } }));
    expect(await healApprovedClaim({ auth }, 'h1', 'approved', true)).toBe(true);
    expect(auth.users.get('h1')!.claims).toEqual({ admin: true, acct: 'approved' });
  });

  it('treats a profile without status as approved only while approval is not required', async () => {
    const off = new FakeAuth(account('h1'));
    expect(await healApprovedClaim({ auth: off }, 'h1', undefined, false)).toBe(true);
    const on = new FakeAuth(account('h2'));
    expect(await healApprovedClaim({ auth: on }, 'h2', undefined, true)).toBe(false);
    expect(await healApprovedClaim({ auth: on }, 'h2', null, true)).toBe(false);
    expect(on.users.get('h2')!.claims).toEqual({});
  });

  it('never touches pending or blocked profiles', async () => {
    const auth = new FakeAuth(account('h1'));
    expect(await healApprovedClaim({ auth }, 'h1', 'pending', false)).toBe(false);
    expect(await healApprovedClaim({ auth }, 'h1', 'blocked', false)).toBe(false);
    expect(auth.users.get('h1')!.claims).toEqual({});
  });

  it('leaves an existing claim, a disabled user and a missing user alone', async () => {
    const auth = new FakeAuth(
      account('b1', { claims: { acct: 'blocked' } }),
      account('d1', { disabled: true }),
    );
    expect(await healApprovedClaim({ auth }, 'b1', 'approved', false)).toBe(false);
    expect(auth.users.get('b1')!.claims).toEqual({ acct: 'blocked' });
    expect(await healApprovedClaim({ auth }, 'd1', 'approved', false)).toBe(false);
    expect(await healApprovedClaim({ auth }, 'nobody', 'approved', false)).toBe(false);
  });

  it('is idempotent', async () => {
    const auth = new FakeAuth(account('h1'));
    expect(await healApprovedClaim({ auth }, 'h1', 'approved', false)).toBe(true);
    expect(await healApprovedClaim({ auth }, 'h1', 'approved', false)).toBe(false);
  });
});
