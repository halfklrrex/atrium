import type { BoardKind, BoardRole, EntityState, WorkspaceRole } from '@atrium/shared';
import { DASHBOARD_LIMITS } from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import {
  setDashboardAccessInTransaction,
  type DashboardSharingTx,
  type SharingDashboard,
} from './dashboard-sharing';

const WS = 'ws1';
const D = 'd1';

/** In-memory store behind the transaction interface; enforces reads-before-writes. */
class FakeTx implements DashboardSharingTx {
  dashboards = new Map<string, SharingDashboard & { accessUids: string[] }>();
  workspaces = new Map<string, Record<string, WorkspaceRole>>();
  writes = 0;
  updatedBy: string[] = [];
  private wrote = false;

  begin(): this {
    this.wrote = false;
    return this;
  }
  getDashboard(id: string) {
    if (this.wrote) throw new Error('Read after write inside transaction');
    const d = this.dashboards.get(id);
    return Promise.resolve(d ? structuredClone(d) : null);
  }
  getWorkspaceRoles(id: string) {
    if (this.wrote) throw new Error('Read after write inside transaction');
    const r = this.workspaces.get(id);
    return Promise.resolve(r ? { ...r } : null);
  }
  writeSharing(
    id: string,
    next: { kind: BoardKind; access: Record<string, BoardRole> },
    updatedBy: string,
  ) {
    this.wrote = true;
    this.writes += 1;
    this.updatedBy.push(updatedBy);
    const d = this.dashboards.get(id);
    if (!d) throw new Error('no dashboard');
    d.kind = next.kind;
    d.access = { ...next.access };
    d.accessUids = Object.keys(next.access);
  }
}

// owner1 and admin are workspace admins (so they can hold the dashboard owner role); editor1 is a member.
const ROLES: Record<string, WorkspaceRole> = {
  wsOwner: 'owner',
  admin: 'admin',
  owner1: 'admin',
  editor1: 'member',
  viewer1: 'viewer',
  outsider: 'member',
};

function setup(dashboard: Partial<SharingDashboard> & { accessUids?: string[] } = {}) {
  const tx = new FakeTx();
  tx.workspaces.set(WS, { ...ROLES });
  tx.dashboards.set(D, {
    workspaceId: WS,
    kind: 'private',
    access: { owner1: 'owner', editor1: 'editor' },
    accessUids: ['owner1', 'editor1'],
    state: 'active' as EntityState,
    ...dashboard,
  });
  return tx;
}

const person = (tx: FakeTx, actor: string, uid: string, role: BoardRole | null) =>
  setDashboardAccessInTransaction(tx.begin(), actor, { dashboardId: D, person: { uid, role } });
const kind = (tx: FakeTx, actor: string, to: BoardKind) =>
  setDashboardAccessInTransaction(tx.begin(), actor, { dashboardId: D, kind: to });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpsError);
    return (e as HttpsError).code;
  }
  return 'ok';
};
const reason = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return ((e as HttpsError).details as { reason?: string } | undefined)?.reason;
  }
  return undefined;
};

const invariant = (tx: FakeTx) => {
  const d = tx.dashboards.get(D)!;
  expect([...d.accessUids].sort()).toEqual(Object.keys(d.access).sort());
};

describe('setDashboardAccess: people', () => {
  it('adds, changes and removes people, keeping accessUids equal to the key set', async () => {
    const tx = setup();
    const added = await person(tx, 'owner1', 'viewer1', 'viewer');
    expect(added.access).toMatchObject({ viewer1: 'viewer' });
    invariant(tx);
    await person(tx, 'owner1', 'editor1', 'viewer');
    expect(tx.dashboards.get(D)!.access.editor1).toBe('viewer');
    const removed = await person(tx, 'owner1', 'editor1', null);
    expect(removed.access).toEqual({ owner1: 'owner', viewer1: 'viewer' });
    invariant(tx);
    expect(tx.updatedBy.every((u) => u === 'owner1')).toBe(true);
  });

  it('requires the target to be a current workspace member', async () => {
    const tx = setup();
    expect(await code(person(tx, 'owner1', 'stranger', 'viewer'))).toBe('failed-precondition');
    expect(tx.writes).toBe(0);
  });

  it('caps the role by the workspace role', async () => {
    const tx = setup();
    expect(await reason(person(tx, 'owner1', 'viewer1', 'editor'))).toBe('role_above_workspace');
    expect(await reason(person(tx, 'owner1', 'viewer1', 'owner'))).toBe('role_above_workspace');
    expect(await reason(person(tx, 'owner1', 'editor1', 'owner'))).toBe('role_above_workspace');
    expect(await code(person(tx, 'owner1', 'viewer1', 'viewer'))).toBe('ok');
    expect(await code(person(tx, 'owner1', 'admin', 'owner'))).toBe('ok');
    expect(tx.dashboards.get(D)!.access.admin).toBe('owner');
  });

  it('refuses non-owners, including editors and people who cannot see the dashboard', async () => {
    const tx = setup();
    expect(await code(person(tx, 'editor1', 'viewer1', 'viewer'))).toBe('permission-denied');
    expect(await code(person(tx, 'outsider', 'viewer1', 'viewer'))).toBe('not-found');
    // a workspace owner is not implicitly on a private dashboard
    expect(await code(person(tx, 'wsOwner', 'viewer1', 'viewer'))).toBe('not-found');
    expect(tx.writes).toBe(0);
  });

  it('refuses people who are no longer workspace members and unknown dashboards', async () => {
    const tx = setup();
    delete tx.workspaces.get(WS)!.owner1;
    expect(await code(person(tx, 'owner1', 'viewer1', 'viewer'))).toBe('not-found');
    expect(
      await code(
        setDashboardAccessInTransaction(tx.begin(), 'admin', {
          dashboardId: 'nope',
          kind: 'main',
        }),
      ),
    ).toBe('not-found');
  });

  it('lets workspace owners and admins manage a main dashboard without being listed', async () => {
    const tx = setup({ kind: 'main', access: {}, accessUids: [] });
    expect(await code(person(tx, 'admin', 'viewer1', 'viewer'))).toBe('ok');
    expect(tx.dashboards.get(D)!.access).toEqual({ viewer1: 'viewer' });
    // a workspace member (implicit editor) cannot
    expect(await code(person(tx, 'editor1', 'viewer1', null))).toBe('permission-denied');
  });

  it('keeps a live owner on private and shareable dashboards', async () => {
    const tx = setup();
    expect(await reason(person(tx, 'owner1', 'owner1', null))).toBe('last_owner');
    expect(await reason(person(tx, 'owner1', 'owner1', 'editor'))).toBe('last_owner');
    expect(tx.writes).toBe(0);
    await person(tx, 'owner1', 'admin', 'owner');
    expect(await code(person(tx, 'owner1', 'owner1', null))).toBe('ok');
  });

  it('does not count a removed workspace member as a live owner', async () => {
    const tx = setup({
      access: { owner1: 'owner', gone: 'owner' },
      accessUids: ['owner1', 'gone'],
    });
    expect(await reason(person(tx, 'owner1', 'owner1', null))).toBe('last_owner');
  });

  it('is idempotent and writes nothing for a repeat', async () => {
    const tx = setup();
    await person(tx, 'owner1', 'editor1', 'editor');
    expect(tx.writes).toBe(0);
  });

  it('refuses a deleted dashboard', async () => {
    const tx = setup({ state: 'deleted' });
    expect(await code(person(tx, 'owner1', 'viewer1', 'viewer'))).toBe('failed-precondition');
  });

  it('caps the number of people', async () => {
    const access: Record<string, BoardRole> = { owner1: 'owner' };
    const roles = new Map<string, WorkspaceRole>();
    for (let i = 0; i < DASHBOARD_LIMITS.accessEntries; i += 1) {
      access[`u${i}`] = 'viewer';
      roles.set(`u${i}`, 'viewer');
    }
    const tx = setup({ access, accessUids: Object.keys(access) });
    for (const [uid, role] of roles) tx.workspaces.get(WS)![uid] = role;
    expect(await code(person(tx, 'owner1', 'editor1', 'editor'))).toBe('failed-precondition');
  });
});

describe('setDashboardAccess: kind', () => {
  it('going private or shareable lists the caller as an explicit owner', async () => {
    const tx = setup({ kind: 'main', access: {}, accessUids: [] });
    const r = await kind(tx, 'admin', 'private');
    expect(r).toEqual({ kind: 'private', access: { admin: 'owner' } });
    invariant(tx);
  });

  it('going back to main keeps the explicit access', async () => {
    const tx = setup();
    const r = await kind(tx, 'owner1', 'main');
    expect(r.kind).toBe('main');
    expect(r.access).toEqual({ owner1: 'owner', editor1: 'editor' });
  });

  it('only owners may change the kind', async () => {
    const tx = setup();
    expect(await code(kind(tx, 'editor1', 'main'))).toBe('permission-denied');
    expect(await code(kind(tx, 'outsider', 'main'))).toBe('not-found');
    expect(tx.writes).toBe(0);
  });

  it('applies the kind and a person together', async () => {
    const tx = setup({ kind: 'main', access: {}, accessUids: [] });
    const r = await setDashboardAccessInTransaction(tx.begin(), 'admin', {
      dashboardId: D,
      kind: 'shareable',
      person: { uid: 'editor1', role: 'editor' },
    });
    expect(r).toEqual({ kind: 'shareable', access: { admin: 'owner', editor1: 'editor' } });
    expect(tx.writes).toBe(1);
  });

  it('treats the same kind as no change', async () => {
    const tx = setup();
    await kind(tx, 'owner1', 'private');
    expect(tx.writes).toBe(0);
  });
});
