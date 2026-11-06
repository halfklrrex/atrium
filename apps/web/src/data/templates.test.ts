import { BUILT_IN_TEMPLATES, type BoardStructure } from '@atrium/shared';
import type * as firestore from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  setDoc: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  getDocs: vi.fn(),
  batchSet: vi.fn(),
  commit: vi.fn(),
  ids: 0,
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof firestore>();
  return {
    ...actual,
    serverTimestamp: () => 'SERVER_TIME',
    collection: (_db: unknown, ...segments: string[]) => {
      const ref = { path: segments.join('/'), withConverter: () => ref };
      return ref;
    },
    doc: (parent: { path: string } | unknown, ...segments: string[]) => {
      const base = (parent as { path?: string }).path;
      const id = segments.length > 0 ? segments.join('/') : `gen${++m.ids}`;
      return {
        id: segments.at(-1) ?? id,
        path: base && segments.length === 0 ? `${base}/${id}` : id,
      };
    },
    query: (ref: unknown) => ref,
    where: () => ({}),
    setDoc: m.setDoc,
    updateDoc: m.update,
    deleteDoc: m.del,
    getDocs: m.getDocs,
    writeBatch: () => ({ set: m.batchSet, commit: m.commit }),
  };
});
vi.mock('../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));

import { writes } from './firestore';
import type { BoardDoc } from './model';
import { sampleItemsToInputs } from './template-items';

beforeEach(() => {
  vi.clearAllMocks();
  m.ids = 0;
  m.commit.mockResolvedValue(undefined);
  m.setDoc.mockResolvedValue(undefined);
});

const structure = (): BoardStructure => ({
  columns: [{ id: 'status', type: 'status', title: 'Status', position: 'a0', settings: {} }],
  subitemColumns: [],
  groups: [
    { id: 'g1', title: 'One', color: '#579bfc', position: 'a0' },
    { id: 'g2', title: 'Two', color: '#037f4c', position: 'a1' },
  ],
  itemTerminology: 'item',
});

describe('createBoardFromStructure', () => {
  it('creates the board with the structure and empty server-maintained id lists', async () => {
    await writes.createBoardFromStructure('u1', 'w1', { name: ' Plan ' }, 'a5', structure(), []);
    const [, doc] = m.setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(doc).toMatchObject({
      workspaceId: 'w1',
      name: 'Plan',
      kind: 'main',
      folderId: null,
      access: { u1: 'owner' },
      accessUids: ['u1'],
      position: 'a5',
      derivedColumnIds: [],
      serverManagedColumnIds: [],
      requiredColumnIds: [],
      state: 'active',
      itemTerminology: 'item',
    });
    expect(doc.groups).toEqual(structure().groups);
    expect(m.batchSet).not.toHaveBeenCalled();
  });

  it('writes the sample items in a second batch after the board', async () => {
    await writes.createBoardFromStructure('u1', 'w1', { name: 'Plan' }, 'a0', structure(), [
      { name: 'A', groupId: 'g1', position: 'a0', values: { status: { index: 1 } } },
      { name: 'B', groupId: 'g2', position: 'a0' },
    ]);
    expect(m.setDoc).toHaveBeenCalledTimes(1);
    expect(m.batchSet).toHaveBeenCalledTimes(2);
    const first = m.batchSet.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(first).toMatchObject({
      name: 'A',
      groupId: 'g1',
      parentItemId: null,
      values: { status: { index: 1 } },
      state: 'active',
      createdBy: 'u1',
    });
    expect((m.batchSet.mock.calls[1]?.[1] as { values: unknown }).values).toEqual({});
  });

  it('still returns the board id when the sample items fail to save', async () => {
    m.commit.mockRejectedValue(new Error('nope'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const id = await writes.createBoardFromStructure('u1', 'w1', { name: 'P' }, 'a0', structure(), [
      { name: 'A', groupId: 'g1', position: 'a0' },
    ]);
    expect(id).toBeTruthy();
    warn.mockRestore();
  });

  it('createBoard still seeds the default structure and its five items', async () => {
    await writes.createBoard('u1', 'w1', { name: 'Blank' }, 'a0');
    const [, doc] = m.setDoc.mock.calls[0] as [
      unknown,
      { columns: { id: string }[]; groups: unknown[] },
    ];
    expect(doc.columns.map((c) => c.id)).toEqual(['person', 'status', 'date']);
    expect(doc.groups).toHaveLength(2);
    expect(m.batchSet).toHaveBeenCalledTimes(5);
  });
});

describe('createBoardFromTemplate', () => {
  const template = BUILT_IN_TEMPLATES[0]!;

  it('keeps column and group ids and creates the sample items', async () => {
    await writes.createBoardFromTemplate('u1', 'w1', { name: 'From template' }, 'a0', template);
    const [, doc] = m.setDoc.mock.calls[0] as [
      unknown,
      { columns: { id: string }[]; groups: { id: string }[] },
    ];
    expect(doc.columns.map((c) => c.id)).toEqual(template.structure.columns.map((c) => c.id));
    expect(doc.groups.map((g) => g.id)).toEqual(template.structure.groups.map((g) => g.id));
    expect(m.batchSet).toHaveBeenCalledTimes(template.sampleItems.length);
  });

  it('skips the sample items when asked', async () => {
    await writes.createBoardFromTemplate('u1', 'w1', { name: 'Empty' }, 'a0', template, {
      includeSampleItems: false,
    });
    expect(m.batchSet).not.toHaveBeenCalled();
  });

  it('strips server-only column marks', async () => {
    const marked = {
      structure: {
        ...structure(),
        columns: [
          {
            id: 'c',
            type: 'text',
            title: 'C',
            position: 'a0',
            settings: {},
            migrating: { snapshotId: 's', startedAt: 1, kind: 'change' as const },
          },
        ],
      },
      sampleItems: [],
    };
    await writes.createBoardFromTemplate('u1', 'w1', { name: 'X' }, 'a0', marked);
    const [, doc] = m.setDoc.mock.calls[0] as [unknown, { columns: object[] }];
    expect(doc.columns[0]).not.toHaveProperty('migrating');
  });
});

describe('sampleItemsToInputs', () => {
  it('gives increasing positions per group and rejects unknown groups', () => {
    const items = sampleItemsToInputs(structure(), [
      { name: 'a', groupId: 'g1', values: {} },
      { name: 'b', groupId: 'g2', values: {} },
      { name: 'c', groupId: 'g1', values: {} },
    ]);
    const g1 = items.filter((i) => i.groupId === 'g1').map((i) => i.position);
    expect(g1).toHaveLength(2);
    expect(g1[0]! < g1[1]!).toBe(true);
    expect(() =>
      sampleItemsToInputs(structure(), [{ name: 'x', groupId: 'nope', values: {} }]),
    ).toThrow(/unknown group/);
  });
});

describe('template writes', () => {
  const board = {
    id: 'b1',
    workspaceId: 'w1',
    ...structure(),
  } as unknown as BoardDoc;

  it('saves a board as a template without reading items by default', async () => {
    await writes.saveBoardAsTemplate('u1', board, { name: ' Mine ' });
    expect(m.getDocs).not.toHaveBeenCalled();
    const [, doc] = m.setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(doc).toMatchObject({
      name: 'Mine',
      description: '',
      sampleItems: [],
      itemCount: 0,
      createdBy: 'u1',
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
    });
  });

  it('includes active top-level items when asked', async () => {
    m.getDocs.mockResolvedValue({
      docs: [
        {
          data: () => ({
            name: 'A',
            groupId: 'g1',
            position: 'a0',
            parentItemId: null,
            state: 'active',
            values: { status: { index: 0 } },
          }),
        },
      ],
    });
    await writes.saveBoardAsTemplate('u1', board, { name: 'With items', includeItems: true });
    const [, doc] = m.setDoc.mock.calls[0] as [
      unknown,
      { itemCount: number; sampleItems: unknown[] },
    ];
    expect(doc.itemCount).toBe(1);
    expect(doc.sampleItems).toEqual([
      { name: 'A', groupId: 'g1', values: { status: { index: 0 } } },
    ]);
  });

  it('requires a name', async () => {
    await expect(writes.saveBoardAsTemplate('u1', board, { name: '  ' })).rejects.toThrow();
  });

  it('renames and deletes', async () => {
    await writes.updateTemplate('w1', 't1', { name: 'New', description: 'd' });
    expect(m.update).toHaveBeenCalledWith(expect.anything(), {
      name: 'New',
      description: 'd',
      updatedAt: 'SERVER_TIME',
    });
    await writes.deleteTemplate('w1', 't1');
    expect(m.del).toHaveBeenCalled();
  });
});
