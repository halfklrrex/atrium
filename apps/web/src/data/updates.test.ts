import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReply,
  createUpdate,
  deleteReply,
  deleteUpdate,
  toggleLikeReply,
  toggleLikeUpdate,
  updateItemName,
} from './updates';

const mockSetDoc = vi.fn();
const mockUpdateDoc = vi.fn();
const mockDeleteDoc = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchCommit = vi.fn();

vi.mock('../lib/firebase', () => ({
  db: {},
}));

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('firebase/firestore');
  return {
    ...actual,
    collection: vi.fn((...args) => ({
      type: 'collection',
      path: args.slice(1).join('/'),
      withConverter: vi.fn().mockReturnThis(),
    })),
    doc: vi.fn((...args) => {
      const isCollectionRef = args[0] && typeof args[0] === 'object' && 'path' in args[0];
      const id = isCollectionRef
        ? (args[1] ?? 'mock-doc-id')
        : (args[args.length - 1] ?? 'mock-doc-id');
      return {
        id,
        path: isCollectionRef ? `${args[0].path}/${id}` : args.slice(1).join('/'),
        withConverter: vi.fn().mockReturnThis(),
      };
    }),
    setDoc: vi.fn((...args) => mockSetDoc(...args)),
    updateDoc: vi.fn((...args) => mockUpdateDoc(...args)),
    deleteDoc: vi.fn((...args) => mockDeleteDoc(...args)),
    writeBatch: vi.fn(() => ({
      set: (...args: unknown[]) => mockBatchSet(...args),
      update: (...args: unknown[]) => mockBatchUpdate(...args),
      commit: () => mockBatchCommit(),
    })),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    arrayUnion: (v: unknown) => ({ arrayUnion: v }),
    arrayRemove: (v: unknown) => ({ arrayRemove: v }),
    increment: (n: number) => ({ increment: n }),
  };
});

describe('updates data access mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createUpdate validates content and writes post and counter in one batch', async () => {
    const id = await createUpdate({
      boardId: 'b1',
      itemId: 'i1',
      authorId: 'u1',
      authorName: 'Ada',
      content: 'Hello world update',
    });

    expect(id).toBe('mock-doc-id');
    expect(mockBatchSet).toHaveBeenCalledOnce();
    expect(mockBatchCommit).toHaveBeenCalledOnce();
    // The item's updates counter moves in the same batch as the post.
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('items/i1') }),
      { updatesCount: { increment: 1 } },
    );
    const payload = (mockBatchSet.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(payload.content).toBe('Hello world update');
    expect(payload.authorId).toBe('u1');
    expect(payload.authorName).toBe('Ada');
    expect(payload.repliesCount).toBe(0);
    expect(payload.likes).toEqual([]);
  });

  it('createUpdate rejects empty content', async () => {
    await expect(
      createUpdate({
        boardId: 'b1',
        itemId: 'i1',
        authorId: 'u1',
        content: '   ',
      }),
    ).rejects.toThrow();
  });

  it('toggleLikeUpdate adds like if not currently liked', async () => {
    await toggleLikeUpdate({
      boardId: 'b1',
      itemId: 'i1',
      updateId: 'u1',
      uid: 'u2',
      currentLikes: ['u1'],
    });

    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    expect((mockUpdateDoc.mock.calls[0] as unknown[])[1]).toEqual({
      likes: { arrayUnion: 'u2' },
    });
  });

  it('toggleLikeUpdate removes like if already liked', async () => {
    await toggleLikeUpdate({
      boardId: 'b1',
      itemId: 'i1',
      updateId: 'u1',
      uid: 'u1',
      currentLikes: ['u1', 'u2'],
    });

    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    expect((mockUpdateDoc.mock.calls[0] as unknown[])[1]).toEqual({
      likes: { arrayRemove: 'u1' },
    });
  });

  it('toggleLikeReply adds or removes like on reply', async () => {
    await toggleLikeReply({
      boardId: 'b1',
      itemId: 'i1',
      updateId: 'u1',
      replyId: 'r1',
      uid: 'u2',
      currentLikes: ['u1'],
    });

    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), {
      likes: { arrayUnion: 'u2' },
    });
  });

  it('createReply validates content, creates reply and increments parent repliesCount', async () => {
    const replyId = await createReply({
      boardId: 'b1',
      itemId: 'i1',
      updateId: 'u1',
      authorId: 'u2',
      authorName: 'Grace',
      content: 'A thoughtful reply',
    });

    expect(replyId).toBe('mock-doc-id');
    expect(mockSetDoc).toHaveBeenCalledOnce();
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repliesCount: { increment: 1 } }),
    );
  });

  it('deleteUpdate calls deleteDoc and decrements the item updatesCount', async () => {
    await deleteUpdate({
      boardId: 'b1',
      itemId: 'i1',
      updateId: 'u1',
    });

    expect(mockDeleteDoc).toHaveBeenCalledOnce();
    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), {
      updatesCount: { increment: -1 },
    });
  });

  it('deleteUpdate still succeeds when the counter cannot be decremented', async () => {
    mockUpdateDoc.mockRejectedValueOnce(new Error('permission-denied'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      deleteUpdate({ boardId: 'b1', itemId: 'i1', updateId: 'u1' }),
    ).resolves.toBeUndefined();
  });

  it('deleteReply calls deleteDoc and decrements parent repliesCount', async () => {
    await deleteReply({
      boardId: 'b1',
      itemId: 'i1',
      updateId: 'u1',
      replyId: 'r1',
    });

    expect(mockDeleteDoc).toHaveBeenCalledOnce();
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repliesCount: { increment: -1 } }),
    );
  });

  it('updateItemName updates name if non-empty', async () => {
    await updateItemName('b1', 'i1', 'New Name', 'u1');
    expect(mockUpdateDoc).toHaveBeenCalledOnce();
    expect((mockUpdateDoc.mock.calls[0] as unknown[])[1]).toMatchObject({
      name: 'New Name',
      updatedBy: 'u1',
    });
  });
});
