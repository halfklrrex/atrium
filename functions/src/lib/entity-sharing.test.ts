import { DOC_LIMITS } from '@atrium/shared';
import type { BoardKind, BoardRole, WorkspaceRole } from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it } from 'vitest';
import {
  setEntityAccessInTransaction,
  type EntitySharingConfig,
  type EntitySharingTx,
  type SharingEntity,
} from './entity-sharing';

const CONFIG: EntitySharingConfig = { noun: 'doc', accessEntries: DOC_LIMITS.accessEntries };
const WS = 'ws1';
const D = 'doc1';

class FakeTx implements EntitySharingTx {
  docs = new Map<string, SharingEntity & { accessUids: string[] }>();
  roles: Record<string, WorkspaceRole> = {
    admin: 'admin',
    owner1: 'admin',
    editor1: 'member',
    viewer1: 'viewer',
    outsider: 'member',
  };
  writes = 0;
  private wrote = false;
  begin(): this {
    this.wrote = false;
    return this;
  }
  getEntity(id: string) {
    if (this.wrote) throw new Error('Read after write inside transaction');
    const d = this.docs.get(id);
    return Promise.resolve(d ? structuredClone(d) : null);
  }
  getWorkspaceRoles(id: string) {
    if (this.wrote) throw new Error('Read after write inside transaction');
    return Promise.resolve(id === WS ? { ...this.roles } : null);
  }
  writeSharing(id: string, next: { kind: BoardKind; access: Record<string, BoardRole> }) {
    this.wrote = true;
    this.writes += 1;
    const d = this.docs.get(id)!;
    d.kind = next.kind;
    d.access = { ...next.access };
    d.accessUids = Object.keys(next.access);
  }
}

function setup(over: Partial<SharingEntity> & { accessUids?: string[] } = {}) {
  const tx = new FakeTx();
  tx.docs.set(D, {
    workspaceId: WS,
    kind: 'private',
    access: { owner1: 'owner', editor1: 'editor' },
    accessUids: ['owner1', 'editor1'],
    state: 'active',
    ...over,
  });
  return tx;
}

const run = (
  tx: FakeTx,
  actor: string,
  req: Omit<Parameters<typeof setEntityAccessInTransaction>[3], 'id'>,
) => setEntityAccessInTransaction(CONFIG, tx.begin(), actor, { id: D, ...req });

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpsError);
    return e as HttpsError;
  }
  throw new Error('expected a failure');
};

describe('setEntityAccessInTransaction (docs)', () => {
  it('adds and removes people and keeps accessUids equal to the key set', async () => {
    const tx = setup();
    const added = await run(tx, 'owner1', { person: { uid: 'viewer1', role: 'viewer' } });
    expect(added.access).toMatchObject({ viewer1: 'viewer' });
    expect([...tx.docs.get(D)!.accessUids].sort()).toEqual(
      Object.keys(tx.docs.get(D)!.access).sort(),
    );
    const removed = await run(tx, 'owner1', { person: { uid: 'viewer1', role: null } });
    expect(removed.access).toEqual({ owner1: 'owner', editor1: 'editor' });
  });

  it('words every message with "doc"', async () => {
    const tx = setup();
    expect((await failure(run(tx, 'editor1', { kind: 'main' }))).message).toBe(
      'Only doc owners can change who has access.',
    );
    expect(
      (await failure(run(tx, 'owner1', { person: { uid: 'stranger', role: 'viewer' } }))).message,
    ).toBe('Only members of this workspace can be added to a doc.');
    expect(
      (await failure(run(tx, 'owner1', { person: { uid: 'viewer1', role: 'editor' } }))).message,
    ).toBe('Viewers of this workspace can only view docs.');
    const missing = await failure(
      setEntityAccessInTransaction(CONFIG, tx.begin(), 'owner1', { id: 'nope', kind: 'main' }),
    );
    expect(missing.code).toBe('not-found');
    expect(missing.message).toBe('Doc not found.');
  });

  it('hides a doc from people who cannot read it', async () => {
    const tx = setup();
    expect((await failure(run(tx, 'outsider', { kind: 'main' }))).code).toBe('not-found');
    expect(tx.writes).toBe(0);
  });

  it('refuses a deleted doc and a role above the workspace role', async () => {
    const tx = setup({ state: 'deleted' });
    expect((await failure(run(tx, 'owner1', { kind: 'main' }))).message).toMatch(
      /This doc is deleted/,
    );
    const live = setup();
    const err = await failure(run(live, 'owner1', { person: { uid: 'editor1', role: 'owner' } }));
    expect((err.details as { reason?: string }).reason).toBe('role_above_workspace');
  });

  it('keeps a live owner, lists the caller as owner on going private, and is idempotent', async () => {
    const tx = setup();
    const err = await failure(run(tx, 'owner1', { person: { uid: 'owner1', role: null } }));
    expect((err.details as { reason?: string }).reason).toBe('last_owner');
    const main = setup({ kind: 'main', access: {}, accessUids: [] });
    const result = await run(main, 'admin', { kind: 'shareable' });
    expect(result).toEqual({ kind: 'shareable', access: { admin: 'owner' } });
    const writes = main.writes;
    await run(main, 'admin', { kind: 'shareable' });
    expect(main.writes).toBe(writes);
  });

  it('caps the number of people', async () => {
    const access: Record<string, BoardRole> = { owner1: 'owner' };
    for (let i = 0; i < DOC_LIMITS.accessEntries - 1; i++) access[`u${i}`] = 'viewer';
    const tx = setup({ access });
    tx.roles['extra'] = 'member';
    const err = await failure(run(tx, 'owner1', { person: { uid: 'extra', role: 'viewer' } }));
    expect(err.message).toBe(`A doc can list at most ${DOC_LIMITS.accessEntries} people.`);
  });
});
