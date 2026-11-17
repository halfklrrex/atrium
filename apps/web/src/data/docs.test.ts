import { DOC_BODY_MAX_BYTES } from '@atrium/shared';
import type * as firestore from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ts } from '../test/fixtures';

const m = vi.hoisted(() => ({
  setDoc: vi.fn(),
  update: vi.fn(),
  ids: 0,
  wheres: [] as unknown[][],
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
      const ref = {
        id: segments.at(-1) ?? id,
        path: base && segments.length === 0 ? `${base}/${id}` : id,
        withConverter: () => ref,
      };
      return ref;
    },
    query: (ref: unknown, ...clauses: unknown[]) => ({ ref, clauses }),
    where: (...args: unknown[]) => {
      m.wheres.push(args);
      return args;
    },
    setDoc: m.setDoc,
    updateDoc: m.update,
  };
});
vi.mock('../lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));

import {
  DocTooLongError,
  activeDocs,
  deletedDocs,
  docQueries,
  docRefs,
  docWrites,
  isRevConflict,
  mergeDocs,
} from './docs';
import type { DocMetaDoc } from './model';

const meta = (overrides: Partial<DocMetaDoc> & { id: string }): DocMetaDoc => ({
  workspaceId: 'w1',
  folderId: null,
  name: overrides.id,
  kind: 'main',
  access: { u1: 'owner' },
  accessUids: ['u1'],
  position: 'a0',
  icon: null,
  state: 'active',
  deletedAt: null,
  createdAt: ts(),
  createdBy: 'u1',
  updatedAt: ts(),
  ...overrides,
});

const content = { doc: { type: 'doc' as const, content: [{ type: 'paragraph' }] }, text: 'Hi' };

beforeEach(() => {
  vi.clearAllMocks();
  m.ids = 0;
  m.wheres = [];
  m.setDoc.mockResolvedValue(undefined);
  m.update.mockResolvedValue(undefined);
});

describe('refs and queries', () => {
  it('addresses the doc and its body', () => {
    expect(docRefs.doc('d1').path).toBe('docs/d1');
    expect(docRefs.body('d1').path).toBe('docs/d1/content/body');
  });

  it('lists with the two board shapes', () => {
    docQueries.mainInWorkspace('w1');
    docQueries.mineInWorkspace('w1', 'u1');
    expect(m.wheres).toEqual([
      ['workspaceId', '==', 'w1'],
      ['kind', '==', 'main'],
      ['workspaceId', '==', 'w1'],
      ['accessUids', 'array-contains', 'u1'],
    ]);
  });
});

describe('pure helpers', () => {
  it('merges listings by id in position order and hides trashed docs', () => {
    const a = meta({ id: 'a', position: 'a1' });
    const b = meta({ id: 'b', position: 'a0' });
    const trashed = meta({ id: 'c', position: 'a2', state: 'deleted' });
    const merged = mergeDocs([a, b], [a, trashed]);
    expect(merged.map((d) => d.id)).toEqual(['b', 'a', 'c']);
    expect(activeDocs(merged).map((d) => d.id)).toEqual(['b', 'a']);
    expect(deletedDocs(merged).map((d) => d.id)).toEqual(['c']);
  });

  it('recognizes a refused save as a revision conflict', () => {
    expect(isRevConflict({ code: 'permission-denied' })).toBe(true);
    expect(isRevConflict({ code: 'unavailable' })).toBe(false);
    expect(isRevConflict(new Error('x'))).toBe(false);
    expect(isRevConflict(null)).toBe(false);
  });
});

describe('createDoc', () => {
  it('creates with the caller as sole owner and no icon', async () => {
    const id = await docWrites.createDoc('u1', 'w1', { name: ' Notes ' }, 'a5');
    expect(id).toBeTruthy();
    const [, data] = m.setDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(data).toEqual({
      workspaceId: 'w1',
      folderId: null,
      name: 'Notes',
      kind: 'main',
      access: { u1: 'owner' },
      accessUids: ['u1'],
      position: 'a5',
      icon: null,
      state: 'active',
      deletedAt: null,
      createdAt: 'SERVER_TIME',
      createdBy: 'u1',
      updatedAt: 'SERVER_TIME',
    });
  });

  it('honors kind and folder, and rejects an empty name', async () => {
    await docWrites.createDoc('u1', 'w1', { name: 'P', kind: 'private', folderId: 'f1' }, 'a0');
    expect(m.setDoc.mock.calls[0]?.[1]).toMatchObject({ kind: 'private', folderId: 'f1' });
    await expect(docWrites.createDoc('u1', 'w1', { name: ' ' }, 'a0')).rejects.toThrow();
    expect(m.setDoc).toHaveBeenCalledTimes(1);
  });
});

describe('rename, move, delete and restore', () => {
  it('renames with a trimmed name and stamps the audit fields', async () => {
    await docWrites.renameDoc('d1', ' New ');
    expect(m.update.mock.calls[0]?.[1]).toEqual({
      name: 'New',
      updatedAt: 'SERVER_TIME',
      updatedBy: 'u1',
    });
  });

  it('refuses a bad name before writing', async () => {
    await expect(docWrites.renameDoc('d1', '')).rejects.toThrow();
    await expect(docWrites.renameDoc('d1', 'x'.repeat(81))).rejects.toThrow();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('moves to a folder and position', async () => {
    await docWrites.moveDoc('d1', 'f1', 'a3');
    expect(m.update.mock.calls[0]?.[1]).toEqual({
      folderId: 'f1',
      position: 'a3',
      updatedAt: 'SERVER_TIME',
      updatedBy: 'u1',
    });
  });

  it('trashes and restores with deletedAt', async () => {
    await docWrites.deleteDoc('d1');
    expect(m.update.mock.calls[0]?.[1]).toMatchObject({
      state: 'deleted',
      deletedAt: 'SERVER_TIME',
    });
    await docWrites.restoreDoc('d1');
    expect(m.update.mock.calls[1]?.[1]).toMatchObject({ state: 'active', deletedAt: null });
  });
});

describe('saveBody', () => {
  it('creates the first body with rev 1', async () => {
    await expect(docWrites.saveBody('d1', content, 0)).resolves.toBe(1);
    expect(m.update).not.toHaveBeenCalled();
    const [ref, data] = m.setDoc.mock.calls[0] as [{ path: string }, Record<string, unknown>];
    expect(ref.path).toBe('docs/d1/content/body');
    expect(data).toEqual({
      doc: content.doc,
      text: 'Hi',
      rev: 1,
      updatedAt: 'SERVER_TIME',
      updatedBy: 'u1',
    });
  });

  it('updates with baseRev + 1 and returns it', async () => {
    await expect(docWrites.saveBody('d1', content, 4)).resolves.toBe(5);
    expect(m.setDoc).not.toHaveBeenCalled();
    expect(m.update.mock.calls[0]?.[1]).toMatchObject({ rev: 5, updatedBy: 'u1' });
  });

  it('cuts the text mirror to its limit', async () => {
    await docWrites.saveBody('d1', { ...content, text: 'x'.repeat(50_100) }, 1);
    expect((m.update.mock.calls[0]?.[1] as { text: string }).text).toHaveLength(50_000);
  });

  it('refuses a body over the byte cap without writing', async () => {
    const big = {
      type: 'doc' as const,
      content: [{ type: 'text', text: 'x'.repeat(DOC_BODY_MAX_BYTES) }],
    };
    await expect(docWrites.saveBody('d1', { doc: big, text: '' }, 1)).rejects.toBeInstanceOf(
      DocTooLongError,
    );
    expect(m.update).not.toHaveBeenCalled();
    expect(m.setDoc).not.toHaveBeenCalled();
  });

  it('passes a refused save (stale rev) through for the caller to handle', async () => {
    m.update.mockRejectedValue({ code: 'permission-denied' });
    await expect(docWrites.saveBody('d1', content, 2)).rejects.toSatisfy(isRevConflict);
  });
});
