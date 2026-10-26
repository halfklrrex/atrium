import { MAX_PENDING_INVITES, type WorkspaceRole } from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import {
  acceptInviteInTransaction,
  changeMemberRoleInTransaction,
  cleanupBoardAccess,
  createInviteInTransaction,
  declineInviteInTransaction,
  getInviteStatus,
  leaveWorkspaceInTransaction,
  listMyInvites,
  removeMemberInTransaction,
  revokeInviteInTransaction,
  syncMemberProfiles,
  type Actor,
  type BoardAccessStore,
  type InviteData,
  type InviteReader,
  type MemberProfile,
  type MemberProfileStore,
  type MembershipTx,
  type WorkspaceData,
} from './membership';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const WS = 'ws1';
const BASE = 'https://app.example.com';

const actor = (uid: string, over: Partial<Actor> = {}): Actor => ({
  uid,
  email: `${uid}@example.com`,
  emailVerified: true,
  displayName: `Name ${uid}`,
  photoURL: null,
  ...over,
});

interface MemberDoc extends MemberProfile {
  role: WorkspaceRole;
}

/** In-memory store behind the transaction interface; enforces reads-before-writes. */
class FakeTx implements MembershipTx {
  workspaces = new Map<string, WorkspaceData>();
  members = new Map<string, MemberDoc>();
  invites = new Map<string, InviteData>();
  private wrote = false;
  private counter = 0;

  begin(): this {
    this.wrote = false;
    return this;
  }
  private read() {
    if (this.wrote) throw new Error('Read after write inside transaction');
  }
  private write() {
    this.wrote = true;
  }

  getWorkspace(id: string) {
    this.read();
    const ws = this.workspaces.get(id);
    return Promise.resolve(ws ? structuredClone(ws) : null);
  }
  getInvite(ws: string, id: string) {
    this.read();
    const inv = this.invites.get(`${ws}/${id}`);
    return Promise.resolve(inv ? { ...inv } : null);
  }
  listPendingInvites(ws: string) {
    this.read();
    return Promise.resolve(
      [...this.invites]
        .filter(([key, v]) => key.startsWith(`${ws}/`) && v.status === 'pending')
        .map(([key, data]) => ({ id: key.slice(ws.length + 1), data: { ...data } })),
    );
  }
  listMembers(ws: string) {
    this.read();
    return Promise.resolve(
      [...this.members]
        .filter(([key]) => key.startsWith(`${ws}/`))
        .map(([key, m]) => ({ uid: key.slice(ws.length + 1), email: m.email })),
    );
  }
  newInviteId() {
    return `inv${++this.counter}`;
  }
  createInvite(ws: string, id: string, data: InviteData) {
    this.write();
    if (this.invites.has(`${ws}/${id}`)) throw new Error('invite exists');
    this.invites.set(`${ws}/${id}`, { ...data });
  }
  updateInvite(ws: string, id: string, patch: Partial<InviteData>) {
    this.write();
    const cur = this.invites.get(`${ws}/${id}`);
    if (!cur) throw new Error('no invite');
    this.invites.set(`${ws}/${id}`, { ...cur, ...patch });
  }
  private ws(id: string) {
    const ws = this.workspaces.get(id);
    if (!ws) throw new Error('no workspace');
    return ws;
  }
  addMember(ws: string, uid: string, role: WorkspaceRole, profile: MemberProfile) {
    this.write();
    const w = this.ws(ws);
    w.roles[uid] = role;
    if (!w.memberIds.includes(uid)) w.memberIds.push(uid);
    this.members.set(`${ws}/${uid}`, { ...profile, role });
  }
  ensureMemberDoc(ws: string, uid: string, role: WorkspaceRole, profile: MemberProfile) {
    this.write();
    this.members.set(`${ws}/${uid}`, { ...profile, role });
  }
  setMemberRole(ws: string, uid: string, role: WorkspaceRole) {
    this.write();
    this.ws(ws).roles[uid] = role;
    const m = this.members.get(`${ws}/${uid}`);
    if (m) m.role = role;
  }
  transferOwnership(ws: string, newOwner: string, oldOwner: string) {
    this.write();
    const w = this.ws(ws);
    w.ownerId = newOwner;
    w.roles[newOwner] = 'owner';
    w.roles[oldOwner] = 'admin';
    for (const [uid, role] of [
      [newOwner, 'owner'],
      [oldOwner, 'admin'],
    ] as const) {
      const m = this.members.get(`${ws}/${uid}`);
      if (m) m.role = role;
    }
  }
  removeMember(ws: string, uid: string) {
    this.write();
    const w = this.ws(ws);
    delete w.roles[uid];
    w.memberIds = w.memberIds.filter((m) => m !== uid);
    this.members.delete(`${ws}/${uid}`);
  }
}

function seed(): FakeTx {
  const store = new FakeTx();
  const roles: Record<string, WorkspaceRole> = {
    owner: 'owner',
    admin: 'admin',
    member: 'member',
    viewer: 'viewer',
  };
  store.workspaces.set(WS, {
    name: 'Team',
    ownerId: 'owner',
    memberIds: Object.keys(roles),
    roles,
  });
  for (const [uid, role] of Object.entries(roles)) {
    store.members.set(`${WS}/${uid}`, {
      displayName: `Name ${uid}`,
      photoURL: null,
      email: `${uid}@example.com`,
      role,
    });
  }
  return store;
}

function pendingInvite(over: Partial<InviteData> = {}): InviteData {
  return {
    email: 'friend@example.com',
    role: 'member',
    invitedBy: 'owner',
    invitedByName: 'Name owner',
    workspaceName: 'Team',
    createdAtMs: NOW - DAY,
    expiresAtMs: NOW + 13 * DAY,
    status: 'pending',
    ...over,
  };
}

/** The invariants every operation must keep. */
function expectInvariant(store: FakeTx) {
  const ws = store.workspaces.get(WS)!;
  expect([...ws.memberIds].sort()).toEqual(Object.keys(ws.roles).sort());
  expect(ws.roles[ws.ownerId]).toBe('owner');
  expect(Object.values(ws.roles).filter((r) => r === 'owner')).toHaveLength(1);
  const memberDocs = [...store.members.keys()]
    .filter((k) => k.startsWith(`${WS}/`))
    .map((k) => k.slice(WS.length + 1))
    .sort();
  expect(memberDocs).toEqual([...ws.memberIds].sort());
  for (const uid of ws.memberIds)
    expect(store.members.get(`${WS}/${uid}`)!.role).toBe(ws.roles[uid]);
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpsError) return error.code;
    throw error;
  }
  return 'ok';
};

const invite = (store: FakeTx, who: Actor, email: string, role: 'admin' | 'member' | 'viewer') =>
  createInviteInTransaction(store.begin(), who, { workspaceId: WS, email, role }, NOW, BASE);

describe('createInvite', () => {
  it('lets owners invite any role and admins only member and viewer', async () => {
    const store = seed();
    expect(await code(invite(store, actor('owner'), 'a@example.com', 'admin'))).toBe('ok');
    expect(await code(invite(store, actor('owner'), 'b@example.com', 'viewer'))).toBe('ok');
    expect(await code(invite(store, actor('admin'), 'c@example.com', 'member'))).toBe('ok');
    expect(await code(invite(store, actor('admin'), 'd@example.com', 'admin'))).toBe(
      'permission-denied',
    );
    expect(await code(invite(store, actor('member'), 'e@example.com', 'member'))).toBe(
      'permission-denied',
    );
    expect(await code(invite(store, actor('viewer'), 'f@example.com', 'viewer'))).toBe(
      'permission-denied',
    );
    expect(await code(invite(store, actor('stranger'), 'g@example.com', 'viewer'))).toBe(
      'permission-denied',
    );
  });

  it('returns the link, expires in 14 days and lowercases the email', async () => {
    const store = seed();
    const result = await invite(store, actor('owner'), 'Friend@Example.COM', 'member');
    expect(result.inviteUrl).toBe(`${BASE}/invite/${WS}/${result.inviteId}`);
    const saved = store.invites.get(`${WS}/${result.inviteId}`)!;
    expect(saved).toMatchObject({
      email: 'friend@example.com',
      role: 'member',
      status: 'pending',
      invitedBy: 'owner',
      workspaceName: 'Team',
      expiresAtMs: NOW + 14 * DAY,
    });
  });

  it('refuses an email that already belongs to a member, in any letter case', async () => {
    const store = seed();
    expect(await code(invite(store, actor('owner'), 'MEMBER@example.com', 'viewer'))).toBe(
      'already-exists',
    );
  });

  it('refreshes an existing pending invite instead of adding a second one', async () => {
    const store = seed();
    const first = await invite(store, actor('owner'), 'friend@example.com', 'viewer');
    const later = NOW + 5 * DAY;
    const second = await createInviteInTransaction(
      store.begin(),
      actor('admin'),
      { workspaceId: WS, email: 'friend@example.com', role: 'member' },
      later,
      BASE,
    );
    expect(second.inviteId).toBe(first.inviteId);
    expect(store.invites.size).toBe(1);
    expect(store.invites.get(`${WS}/${first.inviteId}`)).toMatchObject({
      role: 'member',
      invitedBy: 'admin',
      status: 'pending',
      expiresAtMs: later + 14 * DAY,
    });
  });

  it('caps pending invites at 50 but lets an existing email be refreshed', async () => {
    const store = seed();
    for (let i = 0; i < MAX_PENDING_INVITES; i += 1) {
      store.invites.set(`${WS}/seed${i}`, pendingInvite({ email: `p${i}@example.com` }));
    }
    expect(await code(invite(store, actor('owner'), 'new@example.com', 'member'))).toBe(
      'resource-exhausted',
    );
    expect(await code(invite(store, actor('owner'), 'p3@example.com', 'viewer'))).toBe('ok');
  });

  it('does not count expired invites against the cap', async () => {
    const store = seed();
    for (let i = 0; i < MAX_PENDING_INVITES; i += 1) {
      store.invites.set(
        `${WS}/seed${i}`,
        pendingInvite({ email: `p${i}@example.com`, expiresAtMs: NOW - 1 }),
      );
    }
    expect(await code(invite(store, actor('owner'), 'new@example.com', 'member'))).toBe('ok');
  });

  it('writes the inviter member doc when a browser-created workspace has none yet', async () => {
    const store = seed();
    store.members.delete(`${WS}/owner`);
    await invite(
      store,
      actor('owner', { photoURL: 'https://example.com/o.png' }),
      'a@example.com',
      'member',
    );
    expect(store.members.get(`${WS}/owner`)).toEqual({
      displayName: 'Name owner',
      photoURL: 'https://example.com/o.png',
      email: 'owner@example.com',
      role: 'owner',
    });
  });

  it('reports a missing workspace', async () => {
    const store = seed();
    expect(
      await code(
        createInviteInTransaction(
          store.begin(),
          actor('owner'),
          { workspaceId: 'nope', email: 'a@example.com', role: 'member' },
          NOW,
          BASE,
        ),
      ),
    ).toBe('not-found');
  });
});

describe('revokeInvite', () => {
  it('revokes for owners and admins, refuses members', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite());
    store.invites.set(`${WS}/i2`, pendingInvite({ email: 'x@example.com' }));
    const revoke = (who: Actor, id: string) =>
      revokeInviteInTransaction(store.begin(), who, { workspaceId: WS, inviteId: id });
    expect(await code(revoke(actor('member'), 'i1'))).toBe('permission-denied');
    expect(await code(revoke(actor('admin'), 'i1'))).toBe('ok');
    expect(store.invites.get(`${WS}/i1`)!.status).toBe('revoked');
    expect(await code(revoke(actor('owner'), 'i2'))).toBe('ok');
    expect(await code(revoke(actor('owner'), 'missing'))).toBe('not-found');
  });

  it('keeps admin invites for the owner and is idempotent', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite({ role: 'admin' }));
    const revoke = (who: Actor) =>
      revokeInviteInTransaction(store.begin(), who, { workspaceId: WS, inviteId: 'i1' });
    expect(await code(revoke(actor('admin')))).toBe('permission-denied');
    expect(await code(revoke(actor('owner')))).toBe('ok');
    expect(await code(revoke(actor('owner')))).toBe('ok');
  });

  it('refuses to revoke an accepted invite', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite({ status: 'accepted' }));
    expect(
      await code(
        revokeInviteInTransaction(store.begin(), actor('owner'), {
          workspaceId: WS,
          inviteId: 'i1',
        }),
      ),
    ).toBe('failed-precondition');
  });
});

describe('acceptInvite', () => {
  const friend = actor('friend');
  const accept = (store: FakeTx, who = friend, now = NOW) =>
    acceptInviteInTransaction(store.begin(), who, { workspaceId: WS, inviteId: 'i1' }, now);

  it('adds the invitee to roles, memberIds and members and marks the invite accepted', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite({ role: 'viewer' }));
    const result = await accept(store, actor('friend', { photoURL: 'https://example.com/f.png' }));
    expect(result).toEqual({ workspaceId: WS, role: 'viewer' });
    expect(store.workspaces.get(WS)!.roles.friend).toBe('viewer');
    expect(store.members.get(`${WS}/friend`)).toEqual({
      displayName: 'Name friend',
      photoURL: 'https://example.com/f.png',
      email: 'friend@example.com',
      role: 'viewer',
    });
    expect(store.invites.get(`${WS}/i1`)!.status).toBe('accepted');
    expectInvariant(store);
  });

  it('matches the email case-insensitively', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite());
    expect(await code(accept(store, actor('friend', { email: 'FRIEND@Example.com' })))).toBe('ok');
  });

  it('refuses a verified account with another email', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite());
    expect(await code(accept(store, actor('other')))).toBe('permission-denied');
    expect(store.workspaces.get(WS)!.roles.other).toBeUndefined();
  });

  it('refuses an unverified email even when it matches', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite());
    expect(await code(accept(store, actor('friend', { emailVerified: false })))).toBe(
      'permission-denied',
    );
    expect(await code(accept(store, actor('friend', { email: null })))).toBe('permission-denied');
    expect(store.workspaces.get(WS)!.roles.friend).toBeUndefined();
  });

  it('refuses an expired invite', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite({ expiresAtMs: NOW - 1 }));
    expect(await code(accept(store))).toBe('failed-precondition');
    expect(store.workspaces.get(WS)!.roles.friend).toBeUndefined();
  });

  it.each(['revoked', 'declined'] as const)('refuses a %s invite', async (status) => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite({ status }));
    expect(await code(accept(store))).toBe('failed-precondition');
  });

  it('is idempotent for a member who already joined', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite());
    await accept(store);
    const again = await accept(store);
    expect(again).toEqual({ workspaceId: WS, role: 'member' });
    expect(store.workspaces.get(WS)!.memberIds.filter((m) => m === 'friend')).toHaveLength(1);
    expectInvariant(store);
  });

  it('reports a missing invite', async () => {
    const store = seed();
    expect(await code(accept(store))).toBe('not-found');
  });
});

describe('declineInvite', () => {
  const decline = (store: FakeTx, who: Actor) =>
    declineInviteInTransaction(store.begin(), who, { workspaceId: WS, inviteId: 'i1' });

  it('lets only the invitee decline', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite());
    expect(await code(decline(store, actor('owner')))).toBe('permission-denied');
    expect(await code(decline(store, actor('friend', { emailVerified: false })))).toBe(
      'permission-denied',
    );
    expect(await code(decline(store, actor('friend')))).toBe('ok');
    expect(store.invites.get(`${WS}/i1`)!.status).toBe('declined');
    expect(await code(decline(store, actor('friend')))).toBe('ok');
  });
});

describe('changeMemberRole', () => {
  const change = (store: FakeTx, who: string, uid: string, role: WorkspaceRole) =>
    changeMemberRoleInTransaction(store.begin(), actor(who), { workspaceId: WS, uid, role });

  it('lets the owner set admin, member and viewer', async () => {
    const store = seed();
    expect(await code(change(store, 'owner', 'member', 'admin'))).toBe('ok');
    expect(await code(change(store, 'owner', 'admin', 'viewer'))).toBe('ok');
    expect(await code(change(store, 'owner', 'viewer', 'member'))).toBe('ok');
    expect(store.workspaces.get(WS)!.roles).toMatchObject({
      member: 'admin',
      admin: 'viewer',
      viewer: 'member',
    });
    expectInvariant(store);
  });

  it('lets an admin switch members and viewers between member and viewer only', async () => {
    const store = seed();
    expect(await code(change(store, 'admin', 'member', 'viewer'))).toBe('ok');
    expect(await code(change(store, 'admin', 'viewer', 'member'))).toBe('ok');
    expect(await code(change(store, 'admin', 'member', 'admin'))).toBe('permission-denied');
    expect(await code(change(store, 'admin', 'member', 'owner'))).toBe('permission-denied');
    expect(await code(change(store, 'admin', 'owner', 'member'))).toBe('permission-denied');
    expect(await code(change(store, 'admin', 'admin', 'member'))).toBe('permission-denied');
    expectInvariant(store);
  });

  it('refuses members, viewers and strangers', async () => {
    const store = seed();
    expect(await code(change(store, 'member', 'viewer', 'member'))).toBe('permission-denied');
    expect(await code(change(store, 'viewer', 'member', 'viewer'))).toBe('permission-denied');
    expect(await code(change(store, 'stranger', 'member', 'viewer'))).toBe('permission-denied');
  });

  it('transfers ownership: the previous owner becomes admin and ownerId changes', async () => {
    const store = seed();
    expect(await code(change(store, 'owner', 'member', 'owner'))).toBe('ok');
    const ws = store.workspaces.get(WS)!;
    expect(ws.ownerId).toBe('member');
    expect(ws.roles).toMatchObject({ member: 'owner', owner: 'admin' });
    expect(store.members.get(`${WS}/owner`)!.role).toBe('admin');
    expectInvariant(store);
    // The old owner is now an admin and cannot take ownership back.
    expect(await code(change(store, 'owner', 'owner', 'owner'))).toBe('permission-denied');
  });

  it('protects the last owner: no self-demotion, no ownerless workspace', async () => {
    const store = seed();
    expect(await code(change(store, 'owner', 'owner', 'admin'))).toBe('permission-denied');
    expect(await code(change(store, 'owner', 'owner', 'owner'))).toBe('permission-denied');
    expectInvariant(store);
  });

  it('reports unknown members and is idempotent for an unchanged role', async () => {
    const store = seed();
    expect(await code(change(store, 'owner', 'ghost', 'member'))).toBe('not-found');
    expect(await code(change(store, 'owner', 'member', 'member'))).toBe('ok');
  });
});

describe('removeMember and leaveWorkspace', () => {
  const remove = (store: FakeTx, who: string, uid: string) =>
    removeMemberInTransaction(store.begin(), actor(who), { workspaceId: WS, uid });

  it('lets the owner remove anyone but themself', async () => {
    const store = seed();
    expect(await code(remove(store, 'owner', 'admin'))).toBe('ok');
    expect(await code(remove(store, 'owner', 'member'))).toBe('ok');
    expect(await code(remove(store, 'owner', 'viewer'))).toBe('ok');
    expect(await code(remove(store, 'owner', 'owner'))).toBe('failed-precondition');
    expectInvariant(store);
    expect(store.workspaces.get(WS)!.memberIds).toEqual(['owner']);
  });

  it('lets an admin remove members and viewers only', async () => {
    const store = seed();
    expect(await code(remove(store, 'admin', 'member'))).toBe('ok');
    expect(await code(remove(store, 'admin', 'owner'))).toBe('failed-precondition');
    store.workspaces.get(WS)!.roles.admin2 = 'admin';
    store.workspaces.get(WS)!.memberIds.push('admin2');
    expect(await code(remove(store, 'admin', 'admin2'))).toBe('permission-denied');
  });

  it('refuses members, viewers and strangers removing others', async () => {
    const store = seed();
    expect(await code(remove(store, 'member', 'viewer'))).toBe('permission-denied');
    expect(await code(remove(store, 'viewer', 'member'))).toBe('permission-denied');
    expect(await code(remove(store, 'stranger', 'member'))).toBe('permission-denied');
    expectInvariant(store);
  });

  it('reports a person who is not a member', async () => {
    const store = seed();
    expect(await code(remove(store, 'owner', 'ghost'))).toBe('not-found');
  });

  it('lets any member except the owner leave', async () => {
    const store = seed();
    const leave = (who: string) => leaveWorkspaceInTransaction(store.begin(), actor(who), WS);
    expect(await code(leave('viewer'))).toBe('ok');
    expect(await code(leave('member'))).toBe('ok');
    expect(await code(leave('admin'))).toBe('ok');
    expect(await code(leave('owner'))).toBe('failed-precondition');
    expect(await code(leave('stranger'))).toBe('permission-denied');
    expectInvariant(store);
    expect(store.members.has(`${WS}/member`)).toBe(false);
  });

  it('also lets a member remove themself through removeMember', async () => {
    const store = seed();
    expect(await code(remove(store, 'viewer', 'viewer'))).toBe('ok');
    expectInvariant(store);
  });
});

describe('listMyInvites and getInviteStatus', () => {
  function reader(store: FakeTx): InviteReader {
    return {
      findPendingInvitesByEmail: (email) =>
        Promise.resolve(
          [...store.invites]
            .filter(([, v]) => v.email === email && v.status === 'pending')
            .map(([key, data]) => {
              const [workspaceId = '', id = ''] = key.split('/');
              return { workspaceId, id, data };
            }),
        ),
      getInvite: (ws, id) => Promise.resolve(store.invites.get(`${ws}/${id}`) ?? null),
    };
  }

  it('lists only my pending, unexpired invites', async () => {
    const store = seed();
    store.invites.set(`${WS}/live`, pendingInvite());
    store.invites.set(`${WS}/old`, pendingInvite({ expiresAtMs: NOW - 1 }));
    store.invites.set(`${WS}/done`, pendingInvite({ status: 'accepted' }));
    store.invites.set(`${WS}/other`, pendingInvite({ email: 'else@example.com' }));
    const result = await listMyInvites(reader(store), actor('friend'), NOW);
    expect(result.invites).toEqual([
      {
        workspaceId: WS,
        inviteId: 'live',
        workspaceName: 'Team',
        role: 'member',
        invitedBy: 'owner',
        invitedByName: 'Name owner',
        expiresAt: NOW + 13 * DAY,
      },
    ]);
  });

  it('lists nothing for an unverified email', async () => {
    const store = seed();
    store.invites.set(`${WS}/live`, pendingInvite());
    const result = await listMyInvites(
      reader(store),
      actor('friend', { emailVerified: false }),
      NOW,
    );
    expect(result.invites).toEqual([]);
  });

  it('explains a link without leaking the invitee', async () => {
    const store = seed();
    store.invites.set(`${WS}/i1`, pendingInvite());
    store.invites.set(`${WS}/i2`, pendingInvite({ status: 'revoked' }));
    store.invites.set(`${WS}/i3`, pendingInvite({ expiresAtMs: NOW - 1 }));
    const status = (who: Actor, id: string) =>
      getInviteStatus(reader(store), who, { workspaceId: WS, inviteId: id }, NOW);
    expect(await status(actor('friend'), 'i1')).toEqual({
      state: 'pending',
      workspaceName: 'Team',
      invitedByName: 'Name owner',
      role: 'member',
    });
    expect(await status(actor('other'), 'i1')).toEqual({ state: 'wrong_email' });
    expect((await status(actor('friend'), 'i2')).state).toBe('revoked');
    expect((await status(actor('friend'), 'i3')).state).toBe('expired');
    expect(await status(actor('friend'), 'zzz')).toEqual({ state: 'not_found' });
  });
});

describe('cleanupBoardAccess', () => {
  class FakeBoards implements BoardAccessStore {
    constructor(
      public boards: Map<
        string,
        { workspaceId: string; access: Record<string, string>; accessUids: string[] }
      >,
    ) {}
    batches: number[] = [];
    failOn: number | null = null;
    listBoardIdsWithAccess(workspaceId: string, uid: string) {
      return Promise.resolve(
        [...this.boards]
          .filter(([, b]) => b.workspaceId === workspaceId && b.accessUids.includes(uid))
          .map(([id]) => id),
      );
    }
    removeAccess(ids: string[], uid: string) {
      if (this.failOn === this.batches.length) {
        this.batches.push(-1);
        return Promise.reject(new Error('boom'));
      }
      this.batches.push(ids.length);
      for (const id of ids) {
        const b = this.boards.get(id)!;
        delete b.access[uid];
        b.accessUids = b.accessUids.filter((u) => u !== uid);
      }
      return Promise.resolve();
    }
  }

  const board = (workspaceId: string, uids: string[]) => ({
    workspaceId,
    access: Object.fromEntries(uids.map((u) => [u, 'editor'])),
    accessUids: uids,
  });

  it('strips the uid from access and accessUids on that workspace only', async () => {
    const boards = new Map([
      ['b1', board(WS, ['owner', 'gone'])],
      ['b2', board(WS, ['gone'])],
      ['b3', board(WS, ['owner'])],
      ['b4', board('other', ['gone'])],
    ]);
    const store = new FakeBoards(boards);
    expect(await cleanupBoardAccess(store, WS, 'gone')).toBe(2);
    expect(boards.get('b1')).toMatchObject({ access: { owner: 'editor' }, accessUids: ['owner'] });
    expect(boards.get('b2')).toMatchObject({ access: {}, accessUids: [] });
    expect(boards.get('b4')!.accessUids).toEqual(['gone']);
  });

  it('chunks big workspaces into several batches', async () => {
    const boards = new Map(
      Array.from({ length: 950 }, (_, i) => [`b${i}`, board(WS, ['gone'])] as const),
    );
    const store = new FakeBoards(boards);
    expect(await cleanupBoardAccess(store, WS, 'gone')).toBe(950);
    expect(store.batches).toEqual([400, 400, 150]);
  });

  it('logs a failing batch and carries on without throwing', async () => {
    const boards = new Map(
      Array.from({ length: 450 }, (_, i) => [`b${i}`, board(WS, ['gone'])] as const),
    );
    const store = new FakeBoards(boards);
    store.failOn = 0;
    const logged: string[] = [];
    expect(await cleanupBoardAccess(store, WS, 'gone', (m) => logged.push(m))).toBe(50);
    expect(logged).toHaveLength(1);
  });
});

describe('syncMemberProfiles', () => {
  class FakeProfiles implements MemberProfileStore {
    docs = new Map<string, MemberProfile>();
    created: string[] = [];
    updated: string[] = [];
    constructor(public memberships: Array<{ workspaceId: string; role: WorkspaceRole }>) {}
    listMemberships(_uid: string, limit: number) {
      return Promise.resolve(this.memberships.slice(0, limit));
    }
    getMemberProfile(ws: string) {
      return Promise.resolve(this.docs.get(ws) ?? null);
    }
    upsertMemberProfile(
      ws: string,
      _uid: string,
      profile: MemberProfile,
      createWithRole: WorkspaceRole | null,
    ) {
      (createWithRole ? this.created : this.updated).push(ws);
      this.docs.set(ws, profile);
      return Promise.resolve();
    }
  }

  it('creates missing docs, refreshes changed ones and skips current ones', async () => {
    const store = new FakeProfiles([
      { workspaceId: 'a', role: 'owner' },
      { workspaceId: 'b', role: 'member' },
      { workspaceId: 'c', role: 'viewer' },
    ]);
    store.docs.set('b', { displayName: 'Old', photoURL: null, email: 'avery@example.com' });
    store.docs.set('c', {
      displayName: 'Avery Quinn',
      photoURL: 'https://example.com/a.png',
      email: 'avery@example.com',
    });
    const written = await syncMemberProfiles(
      store,
      actor('avery', {
        email: 'Avery@Example.com',
        displayName: 'Avery Quinn',
        photoURL: 'https://example.com/a.png',
      }),
    );
    expect(written).toBe(2);
    expect(store.created).toEqual(['a']);
    expect(store.updated).toEqual(['b']);
  });

  it('looks at no more than 20 workspaces', async () => {
    const store = new FakeProfiles(
      Array.from({ length: 30 }, (_, i) => ({ workspaceId: `w${i}`, role: 'member' as const })),
    );
    expect(await syncMemberProfiles(store, actor('avery'))).toBe(20);
  });
});
