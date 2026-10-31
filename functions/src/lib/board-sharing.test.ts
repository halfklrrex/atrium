import type { BoardKind, BoardRole, EntityState, WorkspaceRole } from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import {
  leaveBoardInTransaction,
  setBoardAccessInTransaction,
  setBoardKindInTransaction,
  type BoardSharingTx,
  type SharingBoard,
} from './board-sharing';

const WS = 'ws1';
const B = 'b1';

/** In-memory store behind the transaction interface; enforces reads-before-writes. */
class FakeTx implements BoardSharingTx {
  boards = new Map<string, SharingBoard & { accessUids: string[] }>();
  workspaces = new Map<string, Record<string, WorkspaceRole>>();
  writes = 0;
  private wrote = false;

  begin(): this {
    this.wrote = false;
    return this;
  }
  getBoard(id: string) {
    if (this.wrote) throw new Error('Read after write inside transaction');
    const b = this.boards.get(id);
    return Promise.resolve(b ? structuredClone(b) : null);
  }
  getWorkspaceRoles(id: string) {
    if (this.wrote) throw new Error('Read after write inside transaction');
    const r = this.workspaces.get(id);
    return Promise.resolve(r ? { ...r } : null);
  }
  writeSharing(id: string, next: { kind: BoardKind; access: Record<string, BoardRole> }) {
    this.wrote = true;
    this.writes += 1;
    const b = this.boards.get(id);
    if (!b) throw new Error('no board');
    b.kind = next.kind;
    b.access = { ...next.access };
    b.accessUids = Object.keys(next.access);
  }
}

// owner1 and admin are workspace admins (so they can hold the board owner role); editor1 is a member.
const ROLES: Record<string, WorkspaceRole> = {
  wsOwner: 'owner',
  admin: 'admin',
  owner1: 'admin',
  editor1: 'member',
  viewer1: 'viewer',
  outsider: 'member',
};

function setup(board: Partial<SharingBoard> = {}) {
  const tx = new FakeTx();
  tx.workspaces.set(WS, { ...ROLES });
  tx.boards.set(B, {
    workspaceId: WS,
    kind: 'private',
    access: { owner1: 'owner', editor1: 'editor' },
    accessUids: ['owner1', 'editor1'],
    state: 'active' as EntityState,
    ...board,
  });
  return tx;
}

const set = (tx: FakeTx, actor: string, uid: string, role: BoardRole | null) =>
  setBoardAccessInTransaction(tx.begin(), actor, { boardId: B, uid, role });
const kind = (tx: FakeTx, actor: string, to: BoardKind) =>
  setBoardKindInTransaction(tx.begin(), actor, { boardId: B, kind: to });
const leave = (tx: FakeTx, actor: string) =>
  leaveBoardInTransaction(tx.begin(), actor, { boardId: B });

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
  const b = tx.boards.get(B)!;
  expect([...b.accessUids].sort()).toEqual(Object.keys(b.access).sort());
};

describe('setBoardAccess', () => {
  it('adds, changes and removes people, keeping accessUids equal to the key set', async () => {
    const tx = setup();
    const added = await set(tx, 'owner1', 'viewer1', 'viewer');
    expect(added.access).toMatchObject({ viewer1: 'viewer' });
    invariant(tx);
    await set(tx, 'owner1', 'editor1', 'viewer');
    expect(tx.boards.get(B)!.access.editor1).toBe('viewer');
    const removed = await set(tx, 'owner1', 'editor1', null);
    expect(removed.access).toEqual({ owner1: 'owner', viewer1: 'viewer' });
    invariant(tx);
  });

  it('requires the target to be a current workspace member', async () => {
    const tx = setup();
    expect(await code(set(tx, 'owner1', 'stranger', 'viewer'))).toBe('failed-precondition');
    expect(tx.writes).toBe(0);
  });

  it('caps the role by the workspace role', async () => {
    const tx = setup();
    expect(await reason(set(tx, 'owner1', 'viewer1', 'editor'))).toBe('role_above_workspace');
    expect(await reason(set(tx, 'owner1', 'viewer1', 'owner'))).toBe('role_above_workspace');
    expect(await reason(set(tx, 'owner1', 'editor1', 'owner'))).toBe('role_above_workspace');
    expect(await code(set(tx, 'owner1', 'viewer1', 'viewer'))).toBe('ok');
    expect(await code(set(tx, 'owner1', 'admin', 'owner'))).toBe('ok');
    expect(tx.boards.get(B)!.access.admin).toBe('owner');
  });

  it('refuses non-owners, including editors and people who cannot see the board', async () => {
    const tx = setup();
    expect(await code(set(tx, 'editor1', 'viewer1', 'viewer'))).toBe('permission-denied');
    expect(await code(set(tx, 'outsider', 'viewer1', 'viewer'))).toBe('not-found');
    // a workspace owner is not implicitly on a private board
    expect(await code(set(tx, 'wsOwner', 'viewer1', 'viewer'))).toBe('not-found');
    expect(tx.writes).toBe(0);
  });

  it('refuses people who are no longer workspace members', async () => {
    const tx = setup();
    delete tx.workspaces.get(WS)!.owner1;
    expect(await code(set(tx, 'owner1', 'viewer1', 'viewer'))).toBe('not-found');
  });

  it('lets workspace owners and admins manage a main board without being listed', async () => {
    const tx = setup({ kind: 'main', access: {}, accessUids: [] });
    expect(await code(set(tx, 'admin', 'viewer1', 'viewer'))).toBe('ok');
    expect(tx.boards.get(B)!.access).toEqual({ viewer1: 'viewer' });
    // a workspace member (implicit editor) cannot
    expect(await code(set(tx, 'editor1', 'viewer1', null))).toBe('permission-denied');
  });

  it('refuses removing or demoting the last owner of a non-main board', async () => {
    const tx = setup();
    expect(await reason(set(tx, 'owner1', 'owner1', null))).toBe('last_owner');
    expect(await reason(set(tx, 'owner1', 'owner1', 'editor'))).toBe('last_owner');
    await set(tx, 'owner1', 'admin', 'owner');
    expect(await code(set(tx, 'owner1', 'owner1', 'editor'))).toBe('ok'); // another owner exists
    invariant(tx);
  });

  it('counts only owners who are still workspace members', async () => {
    const tx = setup({
      access: { gone: 'owner', owner1: 'owner' },
      accessUids: ['gone', 'owner1'],
    });
    expect(await reason(set(tx, 'owner1', 'owner1', 'viewer'))).toBe('last_owner');
  });

  it('allows an empty explicit owner list on a main board', async () => {
    const tx = setup({ kind: 'main', access: { owner1: 'owner' }, accessUids: ['owner1'] });
    expect(await code(set(tx, 'owner1', 'owner1', null))).toBe('ok');
    expect(tx.boards.get(B)!.access).toEqual({});
  });

  it('refuses archived and deleted boards', async () => {
    for (const state of ['archived', 'deleted'] as const) {
      const tx = setup({ state });
      expect(await code(set(tx, 'owner1', 'viewer1', 'viewer'))).toBe('failed-precondition');
    }
  });

  it('is a no-op on a retried identical call', async () => {
    const tx = setup();
    await set(tx, 'owner1', 'viewer1', 'viewer');
    const writes = tx.writes;
    const again = await set(tx, 'owner1', 'viewer1', 'viewer');
    expect(tx.writes).toBe(writes);
    expect(again.access.viewer1).toBe('viewer');
    await set(tx, 'owner1', 'not-listed', null); // removing someone who is not on the board
    expect(tx.writes).toBe(writes);
  });

  it('answers not-found for a missing board or workspace', async () => {
    const tx = setup();
    const missing = setBoardAccessInTransaction(tx.begin(), 'owner1', {
      boardId: 'x',
      uid: 'a',
      role: null,
    });
    expect(await code(missing)).toBe('not-found');
    tx.workspaces.clear();
    expect(await code(set(tx, 'owner1', 'viewer1', 'viewer'))).toBe('not-found');
  });
});

describe('setBoardKind', () => {
  it('goes from main to private and adds the caller as explicit owner', async () => {
    const tx = setup({ kind: 'main', access: { editor1: 'editor' }, accessUids: ['editor1'] });
    const res = await kind(tx, 'admin', 'private');
    expect(res.kind).toBe('private');
    expect(tx.boards.get(B)!.access).toEqual({ editor1: 'editor', admin: 'owner' });
    invariant(tx);
  });

  it('goes from private to main and keeps explicit entries', async () => {
    const tx = setup();
    const res = await kind(tx, 'owner1', 'main');
    expect(res.kind).toBe('main');
    expect(tx.boards.get(B)!.access).toEqual({ owner1: 'owner', editor1: 'editor' });
  });

  it('switches between private and shareable', async () => {
    const tx = setup();
    expect((await kind(tx, 'owner1', 'shareable')).kind).toBe('shareable');
  });

  it('refuses a no-op, non-owners and archived boards', async () => {
    const tx = setup();
    expect(await reason(kind(tx, 'owner1', 'private'))).toBe('no_change');
    expect(await code(kind(tx, 'editor1', 'main'))).toBe('permission-denied');
    expect(await code(kind(tx, 'outsider', 'main'))).toBe('not-found');
    const archived = setup({ state: 'archived' });
    expect(await code(kind(archived, 'owner1', 'main'))).toBe('failed-precondition');
    expect(tx.writes).toBe(0);
  });

  it('lets a workspace owner who is not listed take a main board private', async () => {
    const tx = setup({ kind: 'main', access: {}, accessUids: [] });
    await kind(tx, 'wsOwner', 'private');
    expect(tx.boards.get(B)!.access).toEqual({ wsOwner: 'owner' });
  });
});

describe('leaveBoard', () => {
  it('removes the caller from a private board', async () => {
    const tx = setup();
    const res = await leave(tx, 'editor1');
    expect(res.access).toEqual({ owner1: 'owner' });
    invariant(tx);
  });

  it('lets an owner leave when another owner remains and refuses the last owner', async () => {
    const tx = setup();
    expect(await reason(leave(tx, 'owner1'))).toBe('last_owner');
    await set(tx, 'owner1', 'admin', 'owner');
    expect(await code(leave(tx, 'owner1'))).toBe('ok');
  });

  it('refuses on a main board, for people who are not listed, and on retired boards', async () => {
    expect(await code(leave(setup({ kind: 'main' }), 'editor1'))).toBe('failed-precondition');
    expect(await code(leave(setup(), 'viewer1'))).toBe('not-found'); // no access: board hidden
    expect(await code(leave(setup({ state: 'deleted' }), 'editor1'))).toBe('failed-precondition');
  });
});
