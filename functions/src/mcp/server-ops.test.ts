import { McpUserError } from '@atrium/mcp-core';
import type { Board, FileAttachment, Item, Workspace } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import type { FileStorageBucket, StorageFileMetadata } from '../lib/file-storage';
import type { UpdateAttachmentTx, UpdatePostDoc } from '../lib/update-attachments';
import { createServerOps } from './server-ops';

const OWNER = 'usr_owner';
const EDITOR = 'usr_editor';
const VIEWER = 'usr_viewer';
const OUTSIDER = 'usr_outsider';

const attachment = (id: string, path: string, uploadedBy = EDITOR): FileAttachment => ({
  id,
  name: `${id}.png`,
  storagePath: path,
  size: 10,
  mimeType: 'image/png',
  uploadedAt: '2026-11-05T00:00:00.000Z',
  uploadedBy,
});

class MockTx implements UpdateAttachmentTx {
  boards = new Map<string, Board>();
  workspaces = new Map<string, Workspace>();
  items = new Map<string, Item>();
  posts = new Map<string, UpdatePostDoc>();
  async getBoard(id: string) {
    return this.boards.get(id) ?? null;
  }
  async getWorkspace(id: string) {
    return this.workspaces.get(id) ?? null;
  }
  async getItem(boardId: string, itemId: string) {
    return this.items.get(`${boardId}:${itemId}`) ?? null;
  }
  updateItemValues(boardId: string, itemId: string, values: Record<string, unknown>) {
    const item = this.items.get(`${boardId}:${itemId}`)!;
    item.values = { ...item.values, ...values };
  }
  generateFileId() {
    return 'file_new';
  }
  async getPost(boardId: string, itemId: string, updateId: string, replyId?: string) {
    return this.posts.get([boardId, itemId, updateId, replyId].filter(Boolean).join('/')) ?? null;
  }
  setAttachments(
    boardId: string,
    itemId: string,
    updateId: string,
    replyId: string | undefined,
    attachments: FileAttachment[],
  ) {
    const post = this.posts.get([boardId, itemId, updateId, replyId].filter(Boolean).join('/'))!;
    post.attachments = attachments;
  }
}

function setup(options: { locked?: boolean; types?: string[] } = {}) {
  const tx = new MockTx();
  tx.workspaces.set('ws_1', {
    memberIds: [OWNER, EDITOR, VIEWER],
    roles: { [OWNER]: 'owner', [EDITOR]: 'member', [VIEWER]: 'viewer' },
  } as unknown as Workspace);
  tx.boards.set('b_1', {
    workspaceId: 'ws_1',
    kind: 'main',
    access: {},
    accessUids: [],
    state: 'active',
    columnLocks: options.locked ? ['c_files'] : [],
    columns: [
      {
        id: 'c_files',
        type: 'files',
        title: 'Scans',
        position: 'a0',
        settings: { maxFileSizeMb: 1, ...(options.types ? { allowedTypes: options.types } : {}) },
      },
    ],
  } as unknown as Board);
  tx.items.set('b_1:i_1', {
    name: 'Slip',
    state: 'active',
    values: {
      c_files: {
        files: [attachment('f1', 'boards/b_1/items/i_1/files/f1')],
      },
    },
  } as unknown as Item);
  tx.posts.set('b_1/i_1/u_1', {
    authorId: EDITOR,
    attachments: [attachment('a1', 'boards/b_1/items/i_1/updates/u_1/a1')],
  });

  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const deleted: string[] = [];
  const signed: string[] = [];
  const bucket: FileStorageBucket = {
    async getFileMetadata(path): Promise<StorageFileMetadata | null> {
      const object = objects.get(path);
      return object
        ? {
            size: object.bytes.length,
            contentType: object.contentType,
            timeCreated: '2026-11-18T10:00:00.000Z',
          }
        : null;
    },
    async deleteFile(path) {
      deleted.push(path);
      objects.delete(path);
    },
    async getSignedUploadUrl() {
      throw new Error('an upload URL must never be signed for a connector upload');
    },
    async getSignedDownloadUrl(path, secs, options) {
      signed.push(`${path}|${secs}|${options?.contentDisposition ?? ''}`);
      return { downloadUrl: `https://storage.example.com/${path}?sig=1`, expiresAt: 1_000 + secs };
    },
  };
  const ops = createServerOps({
    runTransaction: (fn) => fn(tx),
    bucket,
    putObject: async (path, bytes, contentType) => {
      objects.set(path, { bytes, contentType });
    },
    runSharing: async () => {
      throw new Error('sharing is not used by the file tests');
    },
    columnTypeStore: {} as never,
    runColumnActions: async () => {
      throw new Error('unused');
    },
    clickButton: async () => {
      throw new Error('unused');
    },
  });
  return { tx, ops, objects, deleted, signed };
}

const upload = {
  boardId: 'b_1',
  itemId: 'i_1',
  columnId: 'c_files',
  name: 'slip.png',
  contentType: 'image/png',
  bytes: new Uint8Array([1, 2, 3, 4]),
};

describe('server ops: upload', () => {
  it('stores the bytes at the canonical path and appends the file to the cell', async () => {
    const { ops, tx, objects } = setup();
    const out = await ops.uploadFile({ uid: EDITOR, ...upload });
    expect(out.filesInCell).toBe(2);
    expect(out.file).toMatchObject({
      id: 'file_new',
      name: 'slip.png',
      size: 4,
      mimeType: 'image/png',
      uploadedBy: EDITOR,
      storagePath: 'boards/b_1/items/i_1/files/file_new',
    });
    expect(objects.get('boards/b_1/items/i_1/files/file_new')?.bytes).toEqual(upload.bytes);
    const cell = tx.items.get('b_1:i_1')!.values.c_files as { files: FileAttachment[] };
    expect(cell.files.map((f) => f.id)).toEqual(['f1', 'file_new']);
  });

  it('refuses a viewer, an outsider, a locked column and a type the column does not allow', async () => {
    for (const uid of [VIEWER, OUTSIDER]) {
      const { ops, objects } = setup();
      await expect(ops.uploadFile({ uid, ...upload })).rejects.toBeInstanceOf(McpUserError);
      expect(objects.size).toBe(0);
    }
    const locked = setup({ locked: true });
    await expect(locked.ops.uploadFile({ uid: EDITOR, ...upload })).rejects.toThrow(/locked/i);
    await expect(locked.ops.uploadFile({ uid: OWNER, ...upload })).resolves.toBeTruthy();
    const typed = setup({ types: ['.pdf'] });
    await expect(typed.ops.uploadFile({ uid: EDITOR, ...upload })).rejects.toThrow(/not allowed/);
    expect(typed.objects.size).toBe(0);
  });

  it('turns a missing column or item into a plain error', async () => {
    const { ops } = setup();
    await expect(
      ops.uploadFile({ uid: EDITOR, ...upload, columnId: 'nope' }),
    ).rejects.toBeInstanceOf(McpUserError);
    await expect(ops.uploadFile({ uid: EDITOR, ...upload, itemId: 'zzz' })).rejects.toThrow(
      /not found/i,
    );
  });

  it('removes the stored object when the cell is no longer valid at finalize', async () => {
    const { ops, tx, objects, deleted } = setup();
    // A cell that was valid for the request but already lists the new id: finalize refuses.
    const original = tx.getItem.bind(tx);
    let calls = 0;
    tx.getItem = async (boardId: string, itemId: string) => {
      calls += 1;
      const item = await original(boardId, itemId);
      if (calls === 2 && item) {
        return {
          ...item,
          values: {
            c_files: { files: [attachment('file_new', 'boards/b_1/items/i_1/files/file_new')] },
          },
        } as Item;
      }
      return item;
    };
    await expect(ops.uploadFile({ uid: EDITOR, ...upload })).rejects.toThrow();
    expect(deleted).toContain('boards/b_1/items/i_1/files/file_new');
    expect(objects.size).toBe(0);
  });
});

describe('server ops: link', () => {
  it('signs a 5 minute link for a column file and an update attachment, for any reader', async () => {
    const { ops, signed } = setup();
    const column = await ops.getFileLink({
      uid: VIEWER,
      boardId: 'b_1',
      itemId: 'i_1',
      columnId: 'c_files',
      fileId: 'f1',
    });
    expect(column.url).toContain('boards/b_1/items/i_1/files/f1');
    expect(column.expiresAt).toBe(1_000 + 300);
    const post = await ops.getFileLink({
      uid: VIEWER,
      boardId: 'b_1',
      itemId: 'i_1',
      updateId: 'u_1',
      fileId: 'a1',
    });
    expect(post.url).toContain('updates/u_1/a1');
    expect(signed).toHaveLength(2);
    expect(signed[1]).toContain('attachment; filename="a1.png"');
  });

  it('is not found for a person outside the workspace and for an unknown file', async () => {
    const { ops, signed } = setup();
    await expect(
      ops.getFileLink({
        uid: OUTSIDER,
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'f1',
      }),
    ).rejects.toBeInstanceOf(McpUserError);
    await expect(
      ops.getFileLink({
        uid: EDITOR,
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'nope',
      }),
    ).rejects.toThrow(/not found/i);
    expect(signed).toHaveLength(0);
  });

  it('refuses a forged storage path', async () => {
    const { ops, tx } = setup();
    tx.items.get('b_1:i_1')!.values = {
      c_files: { files: [attachment('f1', 'boards/other/items/x/files/f1')] },
    };
    await expect(
      ops.getFileLink({
        uid: EDITOR,
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'f1',
      }),
    ).rejects.toThrow(/does not match/);
  });
});

describe('server ops: delete', () => {
  it('removes a column file from the cell and deletes the object', async () => {
    const { ops, tx, deleted } = setup();
    const out = await ops.deleteFile({
      uid: EDITOR,
      boardId: 'b_1',
      itemId: 'i_1',
      columnId: 'c_files',
      fileId: 'f1',
    });
    expect(out).toEqual({ remaining: 0 });
    expect(deleted).toEqual(['boards/b_1/items/i_1/files/f1']);
    expect(tx.items.get('b_1:i_1')!.values.c_files).toEqual({ files: [] });
  });

  it('removes an update attachment for its author or a board owner, not another editor', async () => {
    const owner = setup();
    expect(
      await owner.ops.deleteFile({
        uid: OWNER,
        boardId: 'b_1',
        itemId: 'i_1',
        updateId: 'u_1',
        fileId: 'a1',
      }),
    ).toEqual({ remaining: 0 });
    expect(owner.deleted).toEqual(['boards/b_1/items/i_1/updates/u_1/a1']);
    const viewer = setup();
    await expect(
      viewer.ops.deleteFile({
        uid: VIEWER,
        boardId: 'b_1',
        itemId: 'i_1',
        updateId: 'u_1',
        fileId: 'a1',
      }),
    ).rejects.toBeInstanceOf(McpUserError);
    expect(viewer.deleted).toHaveLength(0);
  });

  it('refuses a viewer on a column file and leaves the file', async () => {
    const { ops, tx, deleted } = setup();
    await expect(
      ops.deleteFile({
        uid: VIEWER,
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'f1',
      }),
    ).rejects.toBeInstanceOf(McpUserError);
    expect(deleted).toHaveLength(0);
    expect((tx.items.get('b_1:i_1')!.values.c_files as { files: unknown[] }).files).toHaveLength(1);
  });
});
