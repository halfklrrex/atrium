import type * as firestore from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setDocMock, batchSetMock, batchUpdateMock, commitMock } = vi.hoisted(() => ({
  batchUpdateMock: vi.fn(),
  setDocMock: vi.fn(),
  batchSetMock: vi.fn(),
  commitMock: vi.fn(),
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof firestore>();
  return {
    ...actual,
    serverTimestamp: () => 'SERVER_TIME',
    setDoc: setDocMock,
    writeBatch: () => ({ set: batchSetMock, update: batchUpdateMock, commit: commitMock }),
  };
});

vi.mock('../lib/firebase', () => ({ db: {} }));

vi.mock('./firestore', () => ({
  plainRefs: {
    item: (boardId: string, itemId: string) => ({ id: itemId, boardId }),
    newItem: (boardId: string) => ({ id: 'generated', boardId }),
  },
}));

import { deleteField } from 'firebase/firestore';
import { itemWrites, PartialBatchError } from './item-writes';

/** An input as a duplicate path might build it from a full item doc, server fields included. */
const input = {
  name: 'Plan Q3',
  groupId: 'g1',
  position: 'a0',
  values: { owner: { personsAndTeams: [{ id: 'u1', kind: 'person' }] } },
  seq: 4,
  boardSeq: 2,
  assigneeUids: ['u1'],
  nameTokens: ['pl', 'pla', 'plan'],
};

const SERVER_FIELDS = ['seq', 'boardSeq', 'assigneeUids', 'nameTokens', 'descriptionImages'];

beforeEach(() => {
  vi.clearAllMocks();
  commitMock.mockResolvedValue(undefined);
});

describe('new items never carry the server-maintained fields', () => {
  it('create builds the document from explicit keys', async () => {
    await itemWrites.create('u1', 'b1', input);
    const written = setDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(written.name).toBe('Plan Q3');
    for (const field of SERVER_FIELDS) expect(written).not.toHaveProperty(field);
  });

  it('createMany builds every document from explicit keys', async () => {
    await itemWrites.createMany('u1', 'b1', [input, { ...input, name: 'Other' }]);
    expect(batchSetMock).toHaveBeenCalledTimes(2);
    for (const call of batchSetMock.mock.calls) {
      const written = call[1] as Record<string, unknown>;
      for (const field of SERVER_FIELDS) expect(written).not.toHaveProperty(field);
    }
  });
});

describe('setValueMany', () => {
  it('clears a cell with deleteField when the value is null (Undo of a previously empty cell)', async () => {
    await itemWrites.setValueMany('u1', 'b1', 'col', [
      { id: 'a', value: null },
      { id: 'b', value: { index: 1 } },
    ]);
    expect(batchUpdateMock).toHaveBeenCalledTimes(2);
    expect(batchUpdateMock.mock.calls[0]![2]).toEqual(deleteField());
    expect(batchUpdateMock.mock.calls[1]![2]).toEqual({ index: 1 });
  });

  it('rethrows the original error when the first chunk fails', async () => {
    const boom = new Error('boom');
    commitMock.mockRejectedValueOnce(boom);
    await expect(itemWrites.setValueMany('u1', 'b1', 'col', [{ id: 'a', value: 1 }])).rejects.toBe(
      boom,
    );
  });

  it('reports what was committed when a later chunk fails', async () => {
    const cells = Array.from({ length: 401 }, (_, i) => ({ id: `i${i}`, value: 1 }));
    commitMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('later'));
    const error = (await itemWrites
      .setValueMany('u1', 'b1', 'col', cells)
      .catch((e: unknown) => e)) as PartialBatchError;
    expect(error).toBeInstanceOf(PartialBatchError);
    expect(error.committedIds).toHaveLength(400);
    expect(error.failedCount).toBe(1);
  });
});
