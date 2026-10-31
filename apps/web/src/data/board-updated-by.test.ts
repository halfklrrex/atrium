import type * as firestore from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateDocMock, batchUpdateMock, commitMock, txUpdateMock } = vi.hoisted(() => ({
  updateDocMock: vi.fn(),
  batchUpdateMock: vi.fn(),
  commitMock: vi.fn(),
  txUpdateMock: vi.fn(),
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof firestore>();
  return {
    ...actual,
    serverTimestamp: () => 'SERVER_TIME',
    doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
    updateDoc: updateDocMock,
    writeBatch: () => ({ update: batchUpdateMock, delete: vi.fn(), commit: commitMock }),
    runTransaction: (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async () => ({
          exists: () => true,
          data: () => ({ columns: [], subitemColumns: [], groups: [], columnLocks: [] }),
        }),
        update: txUpdateMock,
      }),
  };
});

let currentUser: { uid: string } | null = { uid: 'editor-2' };
vi.mock('../lib/firebase', () => ({
  db: {},
  auth: {
    get currentUser() {
      return currentUser;
    },
  },
}));

import { writes } from './firestore';
import { updateBoardStructure } from './structure-writes';

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { uid: 'editor-2' };
  commitMock.mockResolvedValue(undefined);
  updateDocMock.mockResolvedValue(undefined);
});

describe('every client write to a board document sends updatedBy = the signed-in user', () => {
  it('updateBoard (rename, description, move)', async () => {
    await writes.updateBoard('b1', { folderId: 'f1', position: 'a1' });
    expect(updateDocMock.mock.calls[0]?.[1]).toMatchObject({
      folderId: 'f1',
      updatedAt: 'SERVER_TIME',
      updatedBy: 'editor-2',
    });
  });

  it('setBoardState (archive, delete, restore)', async () => {
    await writes.setBoardState('b1', 'archived');
    expect(updateDocMock.mock.calls[0]?.[1]).toMatchObject({
      state: 'archived',
      updatedBy: 'editor-2',
    });
  });

  it('toggleColumnLock', async () => {
    await writes.toggleColumnLock('b1', 'c1', true);
    expect(updateDocMock.mock.calls[0]?.[1]).toMatchObject({ updatedBy: 'editor-2' });
  });

  it('deleteFolder re-parents its boards to the root with updatedBy', async () => {
    await writes.deleteFolder('ws1', 'f1', {
      boards: [
        { id: 'b1', position: 'a0' },
        { id: 'b2', position: 'a1' },
      ],
      folders: [],
    });
    const boardUpdates = batchUpdateMock.mock.calls.filter(([ref]) =>
      (ref as { path: string }).path.startsWith('boards/'),
    );
    expect(boardUpdates).toHaveLength(2);
    for (const [, data] of boardUpdates) {
      expect(data).toMatchObject({ folderId: null, updatedBy: 'editor-2' });
    }
  });

  it('structure transactions (columns and groups)', async () => {
    await updateBoardStructure('b1', () => ({ groups: [] }));
    expect(txUpdateMock.mock.calls[0]?.[1]).toMatchObject({
      groups: [],
      updatedAt: 'SERVER_TIME',
      updatedBy: 'editor-2',
    });
  });

  it('refuses to write when nobody is signed in', async () => {
    currentUser = null;
    await expect(writes.updateBoard('b1', { name: 'x' })).rejects.toThrow(/sign in/i);
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});
