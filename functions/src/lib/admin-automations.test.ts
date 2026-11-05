import { describe, expect, it } from 'vitest';
import { adminAutomationTx, pickAutomations, toAutomationDoc } from './admin-automations';

const stored = (over: Record<string, unknown> = {}) => ({
  name: 'Ship it',
  enabled: true,
  runAs: 'creator',
  trigger: { type: 'item_created' },
  conditions: [],
  actions: [{ type: 'archive_item' }],
  ...over,
});

describe('toAutomationDoc', () => {
  it('parses a valid recipe', () => {
    const doc = toAutomationDoc('a1', stored());
    expect(doc.invalid).toBeUndefined();
    expect(doc.actions).toHaveLength(1);
  });

  it('marks a recipe with no actions, too many actions or too many conditions invalid', () => {
    const archive = { type: 'archive_item' };
    const cond = { columnId: 'c', op: 'is_empty' };
    expect(toAutomationDoc('a', stored({ actions: [] })).invalid).toBeDefined();
    expect(toAutomationDoc('a', stored({ actions: Array(6).fill(archive) })).invalid).toBeDefined();
    expect(
      toAutomationDoc('a', stored({ actions: Array(5).fill(archive) })).invalid,
    ).toBeUndefined();
    expect(toAutomationDoc('a', stored({ conditions: Array(4).fill(cond) })).invalid).toBeDefined();
    expect(
      toAutomationDoc('a', stored({ conditions: Array(3).fill(cond) })).invalid,
    ).toBeUndefined();
  });

  it('marks an unparseable trigger or a missing runAs invalid', () => {
    expect(toAutomationDoc('a', stored({ trigger: { type: 'nope' } })).invalid).toBeDefined();
    expect(toAutomationDoc('a', stored({ runAs: '' })).invalid).toBeDefined();
  });
});

describe('pickAutomations', () => {
  const doc = (id: string, invalid = false) => ({
    ...toAutomationDoc(id, stored()),
    ...(invalid ? { invalid: 'bad' } : {}),
  });

  it('keeps every invalid recipe and caps only the valid ones', () => {
    const docs = [
      doc('bad1', true),
      ...Array.from({ length: 25 }, (_, i) => doc(`v${i}`)),
      doc('bad2', true),
    ];
    const picked = pickAutomations(docs, 20);
    expect(picked.filter((a) => a.invalid === undefined)).toHaveLength(20);
    expect(picked.map((a) => a.id)).toEqual(expect.arrayContaining(['bad1', 'bad2']));
    expect(picked).toHaveLength(22);
  });
});

describe('adminAutomationTx', () => {
  it('reads the workspace document once for the member list and the role lookup', async () => {
    const reads: string[] = [];
    const data: Record<string, Record<string, unknown>> = {
      'boards/b1': { kind: 'main', workspaceId: 'ws', access: {}, columns: [], groups: [] },
      'workspaces/ws': { roles: { creator: 'member', pal: 'admin' } },
    };
    const ref = (path: string): unknown => ({
      path,
      collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    });
    const firestore = {
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    };
    const tx = {
      get: async (r: { path: string }) => {
        reads.push(r.path);
        const doc = data[r.path];
        return { exists: doc !== undefined, get: (field: string) => doc?.[field] };
      },
    };
    const atx = adminAutomationTx(firestore as never, tx as never);
    const board = await atx.getBoard('b1');
    expect(board?.memberUids).toEqual(['creator', 'pal']);
    expect(await atx.getWorkspaceMemberRole('ws', 'pal')).toBe('admin');
    expect(await atx.getWorkspaceMemberRole('ws', 'stranger')).toBeNull();
    expect(reads.filter((p) => p === 'workspaces/ws')).toHaveLength(1);
  });
});
