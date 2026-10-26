import { workspaceSchema, userSchema, type TimestampLike } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  bootstrapUserInTransaction,
  workspaceIconFor,
  type BootstrapTx,
  type Identity,
} from './bootstrap';

const SERVER_TS = { isEqual: () => true };
const fakeTimestamp: TimestampLike = {
  seconds: 1,
  nanoseconds: 0,
  toDate: () => new Date(1000),
  toMillis: () => 1000,
};

interface FakeWorkspace {
  memberIds: string[];
}

/** In-memory store implementing the transaction interface; enforces reads-before-writes. */
class FakeTx implements BootstrapTx {
  users = new Map<string, Record<string, unknown>>();
  workspaces = new Map<string, Record<string, unknown> & Partial<FakeWorkspace>>();
  private wrote = false;
  private counter = 0;

  /** Start a fresh transaction attempt over the same persistent data. */
  begin(): this {
    this.wrote = false;
    return this;
  }

  private assertRead() {
    if (this.wrote) throw new Error('Read after write inside transaction');
  }

  getUser(uid: string) {
    this.assertRead();
    const u = this.users.get(uid);
    const last = u?.lastWorkspaceId;
    return Promise.resolve(u ? { lastWorkspaceId: typeof last === 'string' ? last : null } : null);
  }
  workspaceHasMember(workspaceId: string, uid: string) {
    this.assertRead();
    return Promise.resolve(this.workspaces.get(workspaceId)?.memberIds?.includes(uid) ?? false);
  }
  findMemberWorkspaceId(uid: string) {
    this.assertRead();
    for (const [id, ws] of this.workspaces)
      if (ws.memberIds?.includes(uid)) return Promise.resolve(id);
    return Promise.resolve(null);
  }
  newWorkspaceId() {
    return `ws${++this.counter}`;
  }
  createUser(uid: string, data: object) {
    this.wrote = true;
    if (this.users.has(uid)) throw new Error('user already exists');
    this.users.set(uid, { ...data });
  }
  setLastWorkspace(uid: string, workspaceId: string) {
    this.wrote = true;
    const u = this.users.get(uid);
    if (!u) throw new Error('no such user');
    u.lastWorkspaceId = workspaceId;
  }
  members = new Map<string, Record<string, unknown>>();
  createMember(workspaceId: string, uid: string, profile: object) {
    this.wrote = true;
    this.members.set(`${workspaceId}/${uid}`, { ...profile });
  }
  createWorkspace(id: string, data: object) {
    this.wrote = true;
    if (this.workspaces.has(id)) throw new Error('workspace already exists');
    this.workspaces.set(id, { ...data } as Record<string, unknown> & Partial<FakeWorkspace>);
  }
}

function run(store: FakeTx, identity: Identity, hints = {}) {
  return bootstrapUserInTransaction(store.begin(), identity, hints, SERVER_TS);
}

const ada: Identity = {
  uid: 'u1',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  photoURL: 'https://example.com/ada.png',
};

describe('bootstrapUserInTransaction', () => {
  it('creates the user and a personal workspace on first sign-in', async () => {
    const store = new FakeTx();
    const result = await run(store, ada, { timezone: 'America/New_York', locale: 'es' });

    expect(result).toEqual({ workspaceId: 'ws1' });
    const ws = store.workspaces.get('ws1')!;
    expect(ws).toMatchObject({
      name: "Ada's workspace",
      icon: 'A',
      ownerId: 'u1',
      createdBy: 'u1',
      memberIds: ['u1'],
      roles: { u1: 'owner' },
      kind: 'open',
    });
    expect(store.users.get('u1')).toMatchObject({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      photoURL: 'https://example.com/ada.png',
      timezone: 'America/New_York',
      locale: 'es',
      lastWorkspaceId: 'ws1',
      theme: 'system',
    });
  });

  it('writes the owner member profile with the new workspace', async () => {
    const store = new FakeTx();
    await run(store, ada);
    expect(store.members.get('ws1/u1')).toEqual({
      displayName: 'Ada Lovelace',
      photoURL: 'https://example.com/ada.png',
      email: 'ada@example.com',
    });
  });

  it('writes documents that satisfy the shared schemas', async () => {
    const store = new FakeTx();
    await run(store, ada);
    const withTs = (d: Record<string, unknown>) => ({
      ...d,
      createdAt: fakeTimestamp,
      updatedAt: fakeTimestamp,
    });
    expect(workspaceSchema.safeParse(withTs(store.workspaces.get('ws1')!)).success).toBe(true);
    expect(userSchema.safeParse(withTs(store.users.get('u1')!)).success).toBe(true);
  });

  it('is idempotent: a second call creates nothing and returns the same workspace', async () => {
    const store = new FakeTx();
    const first = await run(store, ada);
    const second = await run(store, ada);
    expect(second).toEqual(first);
    expect(store.workspaces.size).toBe(1);
    expect(store.users.size).toBe(1);
  });

  it('reuses an existing workspace when the user doc is missing', async () => {
    const store = new FakeTx();
    store.workspaces.set('old', { memberIds: ['u1'] });
    const result = await run(store, ada);
    expect(result).toEqual({ workspaceId: 'old' });
    expect(store.workspaces.size).toBe(1);
    expect(store.users.get('u1')?.lastWorkspaceId).toBe('old');
  });

  it('repairs a stale lastWorkspaceId by pointing at a workspace the user belongs to', async () => {
    const store = new FakeTx();
    store.users.set('u1', { lastWorkspaceId: 'gone' });
    store.workspaces.set('w9', { memberIds: ['u1', 'u2'] });
    const result = await run(store, ada);
    expect(result).toEqual({ workspaceId: 'w9' });
    expect(store.users.get('u1')?.lastWorkspaceId).toBe('w9');
  });

  it('creates a workspace for an existing user who has none', async () => {
    const store = new FakeTx();
    store.users.set('u1', { lastWorkspaceId: null });
    const result = await run(store, ada);
    expect(result).toEqual({ workspaceId: 'ws1' });
    expect(store.users.get('u1')?.lastWorkspaceId).toBe('ws1');
  });

  it('falls back gracefully when the token has no name or email', async () => {
    const store = new FakeTx();
    await run(store, { uid: 'u2', displayName: null, email: null, photoURL: null });
    expect(store.workspaces.get('ws1')?.name).toBe('My workspace');
    expect(store.users.get('u2')).toMatchObject({ displayName: '', email: '', photoURL: null });
  });
});

describe('workspaceIconFor', () => {
  it('uses the upper-cased first character and survives emoji / empty names', () => {
    expect(workspaceIconFor('ada')).toBe('A');
    expect(workspaceIconFor('  zed')).toBe('Z');
    expect(workspaceIconFor('🙂 home')).toBe('🙂');
    expect(workspaceIconFor('')).toBe('A');
  });
});
