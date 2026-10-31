import type * as firestore from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setDocMock, batchSetMock, commitMock } = vi.hoisted(() => ({
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
    writeBatch: () => ({ set: batchSetMock, commit: commitMock }),
  };
});

vi.mock('../lib/firebase', () => ({ db: {} }));

vi.mock('./firestore', () => ({
  plainRefs: {
    item: (boardId: string, itemId: string) => ({ id: itemId, boardId }),
    newItem: (boardId: string) => ({ id: 'generated', boardId }),
  },
}));

import { itemWrites } from './item-writes';

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
