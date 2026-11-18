import { McpUserError } from '@atrium/mcp-core';
import type { BoardKind, BoardRole, WorkspaceRole } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import type { BoardSharingTx } from '../lib/board-sharing';
import type { DashboardSharingTx } from '../lib/dashboard-sharing';
import type { EntitySharingTx } from '../lib/entity-sharing';
import { createServerOps, type SharingStores } from './server-ops';

const OWNER = 'usr_owner';
const EDITOR = 'usr_editor';
const VIEWER = 'usr_viewer';
const OUTSIDER = 'usr_outsider';

interface Stored {
  workspaceId: string;
  kind: BoardKind;
  access: Record<string, BoardRole>;
  state: 'active' | 'archived' | 'deleted';
}

/** In-memory store behind all three adapters; like Firestore it refuses a read after a write. */
class FakeStore {
  boards = new Map<string, Stored>();
  docs = new Map<string, Stored>();
  dashboards = new Map<string, Stored>();
  roles: Record<string, WorkspaceRole> = {
    [OWNER]: 'owner',
    [EDITOR]: 'member',
    [VIEWER]: 'viewer',
  };
  writes: string[] = [];
  activity: string[] = [];
  private wrote = false;

  private guard() {
    if (this.wrote) throw new Error('Read after write inside transaction');
  }
  private entityTx(map: Map<string, Stored>, label: string): EntitySharingTx {
    return {
      getEntity: async (id) => {
        this.guard();
        const found = map.get(id);
        return found ? structuredClone(found) : null;
      },
      getWorkspaceRoles: async () => {
        this.guard();
        return { ...this.roles };
      },
      writeSharing: (id, next) => {
        this.wrote = true;
        this.writes.push(`${label}:${id}:${next.kind}`);
        const found = map.get(id)!;
        found.kind = next.kind;
        found.access = { ...next.access };
      },
    };
  }
  stores(): SharingStores {
    this.wrote = false;
    const doc = this.entityTx(this.docs, 'doc');
    const dash = this.entityTx(this.dashboards, 'dashboard');
    const board: BoardSharingTx = {
      getBoard: async (id) => {
        this.guard();
        const found = this.boards.get(id);
        return found ? structuredClone(found) : null;
      },
      getWorkspaceRoles: async () => {
        this.guard();
        return { ...this.roles };
      },
      writeSharing: (id, next) => {
        this.wrote = true;
        this.writes.push(`board:${id}:${next.kind}`);
        const found = this.boards.get(id)!;
        found.kind = next.kind;
        found.access = { ...next.access };
      },
      getMemberProfiles: async (_ws, uids) => {
        this.guard();
        return new Map(uids.map((u) => [u, { name: u, photoURL: null }]));
      },
      appendActivity: (_id, docs) => {
        this.wrote = true;
        for (const d of docs) this.activity.push(String((d as { kind?: string }).kind));
      },
    };
    const dashboard: DashboardSharingTx = {
      getDashboard: (id) => dash.getEntity(id),
      getWorkspaceRoles: (w) => dash.getWorkspaceRoles(w),
      writeSharing: (id, next, by) => dash.writeSharing(id, next, by),
    };
    return { board, doc, dashboard };
  }
}

function setup() {
  const store = new FakeStore();
  const mk = (kind: BoardKind, access: Record<string, BoardRole>): Stored => ({
    workspaceId: 'ws_1',
    kind,
    access,
    state: 'active',
  });
  store.boards.set('b_1', mk('private', { [OWNER]: 'owner', [EDITOR]: 'editor' }));
  store.boards.set('b_main', mk('main', {}));
  store.docs.set('d_1', mk('private', { [OWNER]: 'owner' }));
  store.dashboards.set('x_1', mk('shareable', { [OWNER]: 'owner' }));
  const ops = createServerOps({
    runTransaction: async () => {
      throw new Error('unused');
    },
    columnTypeStore: {} as never,
    runColumnActions: async () => {
      throw new Error('unused');
    },
    clickButton: async () => {
      throw new Error('unused');
    },
    bucket: {} as never,
    putObject: async () => undefined,
    runSharing: (fn) => fn(store.stores()),
  });
  return { store, ops };
}

const call = (ops: ReturnType<typeof setup>['ops'], over: Record<string, unknown>) =>
  ops.setAccess({ uid: OWNER, target: 'doc', id: 'd_1', ...over } as never);

describe('setAccess', () => {
  it('adds a person to a doc and reports the states', async () => {
    const { store, ops } = setup();
    const out = await call(ops, { person: { uid: EDITOR, role: 'editor' } });
    expect(out.before.access).toEqual({ [OWNER]: 'owner' });
    expect(out.after.access).toEqual({ [OWNER]: 'owner', [EDITOR]: 'editor' });
    expect(out.roles[EDITOR]).toBe('member');
    expect(store.docs.get('d_1')!.access[EDITOR]).toBe('editor');
  });

  it('writes nothing on a dry run, for every target', async () => {
    const { store, ops } = setup();
    for (const [target, id] of [
      ['doc', 'd_1'],
      ['dashboard', 'x_1'],
      ['board', 'b_1'],
    ] as const) {
      const out = await call(ops, {
        target,
        id,
        kind: 'main',
        person: { uid: VIEWER, role: 'viewer' },
        dryRun: true,
      });
      expect(out.after.kind).toBe('main');
      expect(out.after.access[VIEWER]).toBe('viewer');
    }
    expect(store.writes).toEqual([]);
    expect(store.boards.get('b_1')!.kind).toBe('private');
  });

  it('changes a dashboard', async () => {
    const { store, ops } = setup();
    await call(ops, { target: 'dashboard', id: 'x_1', person: { uid: EDITOR, role: 'viewer' } });
    expect(store.dashboards.get('x_1')!.access[EDITOR]).toBe('viewer');
  });

  it('changes a board kind and a person in one transaction, with one write and activity entries', async () => {
    const { store, ops } = setup();
    const out = await call(ops, {
      target: 'board',
      id: 'b_main',
      kind: 'private',
      person: { uid: EDITOR, role: 'editor' },
    });
    expect(out.before).toEqual({ kind: 'main', access: {} });
    expect(out.after).toEqual({
      kind: 'private',
      access: { [OWNER]: 'owner', [EDITOR]: 'editor' },
    });
    expect(store.writes).toEqual(['board:b_main:private']);
    expect(store.activity).toEqual(['board_kind_changed', 'board_access_changed']);
  });

  it('changes only a board person without touching the kind', async () => {
    const { store, ops } = setup();
    const out = await call(ops, {
      target: 'board',
      id: 'b_1',
      person: { uid: EDITOR, role: null },
    });
    expect(out.after.access).toEqual({ [OWNER]: 'owner' });
    expect(store.boards.get('b_1')!.access).toEqual({ [OWNER]: 'owner' });
  });

  it('passes the last-owner refusal through as a user error', async () => {
    const { ops } = setup();
    const error = await call(ops, { person: { uid: OWNER, role: null } }).catch((e) => e);
    expect(error).toBeInstanceOf(McpUserError);
    expect(error.message).toMatch(/needs at least one owner/);
  });

  it('refuses a person who is not a workspace member', async () => {
    const { ops } = setup();
    const error = await call(ops, { person: { uid: OUTSIDER, role: 'viewer' } }).catch((e) => e);
    expect(error).toBeInstanceOf(McpUserError);
    expect(error.message).toMatch(/Only members of this workspace/);
  });

  it('refuses a role above the workspace role and a non-owner actor', async () => {
    const { ops } = setup();
    const capped = await call(ops, { person: { uid: EDITOR, role: 'owner' } }).catch((e) => e);
    expect(capped.message).toMatch(/can edit docs but not own them/);
    const notOwner = await ops
      .setAccess({
        uid: EDITOR,
        target: 'board',
        id: 'b_1',
        person: { uid: VIEWER, role: 'viewer' },
      })
      .catch((e) => e);
    expect(notOwner).toBeInstanceOf(McpUserError);
    expect(notOwner.message).toMatch(/Only board owners/);
  });

  it('hides an object the actor cannot read', async () => {
    const { ops } = setup();
    const error = await ops
      .setAccess({ uid: VIEWER, target: 'doc', id: 'd_1', kind: 'main' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(McpUserError);
    expect(error.message).toBe('Doc not found.');
  });
});
