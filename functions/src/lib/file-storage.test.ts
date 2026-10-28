import type { Board, FilesValue, Item, Workspace, WorkspaceRole } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  deleteFileAttachmentInTransaction,
  finalizeFileUploadInTransaction,
  getFileDownloadUrlInTransaction,
  requestFileUploadInTransaction,
  sweepOrphanUploads,
  type FileStorageBucket,
  type FileStorageTx,
  type OrphanSweeperStore,
  type StorageFileMetadata,
} from './file-storage';

class MockFileStorageTx implements FileStorageTx {
  constructor(
    public boards: Map<string, Board> = new Map(),
    public workspaces: Map<string, Workspace> = new Map(),
    public items: Map<string, Item> = new Map(),
    public updatedValues: Map<string, Record<string, unknown>> = new Map(),
  ) {}

  async getBoard(boardId: string): Promise<Board | null> {
    return this.boards.get(boardId) ?? null;
  }

  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    return this.workspaces.get(workspaceId) ?? null;
  }

  async getItem(boardId: string, itemId: string): Promise<Item | null> {
    return this.items.get(`${boardId}:${itemId}`) ?? null;
  }

  updateItemValues(boardId: string, itemId: string, values: Record<string, unknown>): void {
    const key = `${boardId}:${itemId}`;
    const current = this.items.get(key);
    if (current) {
      current.values = { ...(current.values ?? {}), ...values };
    }
    this.updatedValues.set(key, values);
  }

  generateFileId(): string {
    return 'file_mock_123';
  }
}

class MockStorageBucket implements FileStorageBucket {
  public deletedFiles: string[] = [];
  public lastUploadSize?: number;
  public lastUploadHeaders?: Record<string, string>;

  constructor(public files: Map<string, StorageFileMetadata> = new Map()) {}

  async getFileMetadata(storagePath: string): Promise<StorageFileMetadata | null> {
    return this.files.get(storagePath) ?? null;
  }

  async deleteFile(storagePath: string): Promise<void> {
    this.deletedFiles.push(storagePath);
    this.files.delete(storagePath);
  }

  async getSignedUploadUrl(
    storagePath: string,
    contentType: string,
    size: number,
    expiresInSeconds: number,
  ): Promise<{ uploadUrl: string; expiresAt: number; headers: Record<string, string> }> {
    this.lastUploadSize = size;
    const headers = {
      'content-type': contentType,
      'x-goog-content-length-range': `0,${size}`,
    };
    this.lastUploadHeaders = headers;
    return {
      uploadUrl: `https://storage.mock.local/${storagePath}?upload=true&type=${encodeURIComponent(contentType)}`,
      expiresAt: 1700000000 + expiresInSeconds,
      headers,
    };
  }

  async getSignedDownloadUrl(
    storagePath: string,
    expiresInSeconds: number,
  ): Promise<{ downloadUrl: string; expiresAt: number }> {
    return {
      downloadUrl: `https://storage.mock.local/${storagePath}?download=true`,
      expiresAt: 1700000000 + expiresInSeconds,
    };
  }
}

const ts = {
  seconds: 1700000000,
  nanoseconds: 0,
  toDate: () => new Date('2026-10-25T00:00:00Z'),
  toMillis: () => 1700000000000,
};

function makeWorkspace(uid: string, role: WorkspaceRole = 'owner'): Workspace {
  return {
    name: 'Test WS',
    description: '',
    icon: 'T',
    color: '#6161ff',
    ownerId: uid,
    memberIds: [uid],
    roles: { [uid]: role },
    kind: 'open',
    createdAt: ts,
    createdBy: uid,
    updatedAt: ts,
  };
}

function makeBoard(uid: string, kind: 'main' | 'private' = 'main'): Board {
  return {
    workspaceId: 'ws_1',
    folderId: null,
    name: 'Test Board',
    description: '',
    kind,
    access: { [uid]: 'owner' },
    accessUids: [uid],
    position: 'a0',
    icon: null,
    columns: [
      {
        id: 'c_files',
        type: 'files',
        title: 'Documents',
        position: 'a0',
        settings: {
          maxFileSizeMb: 10,
          allowedTypes: ['image/*', '.pdf'],
        },
      },
    ],
    subitemColumns: [],
    derivedColumnIds: [],
    serverManagedColumnIds: ['c_files'],
    columnLocks: [],
    groups: [],
    itemTerminology: 'item',
    state: 'active',
    deletedAt: null,
    createdAt: ts,
    createdBy: uid,
    updatedAt: ts,
  };
}

function makeItem(
  boardId: string,
  itemId: string,
  state: 'active' | 'archived' | 'deleted' = 'active',
): Item {
  return {
    name: 'Test Item',
    groupId: 'g_1',
    position: 'a0',
    parentItemId: null,
    values: {},
    state,
    deletedAt: null,
    createdAt: ts,
    createdBy: 'usr_1',
    updatedAt: ts,
    updatedBy: 'usr_1',
  };
}

describe('file-storage requestFileUpload', () => {
  it('passes size constraint and returns x-goog-content-length-range header', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const uid = 'usr_1';

    tx.workspaces.set('ws_1', makeWorkspace(uid, 'owner'));
    tx.boards.set('b_1', makeBoard(uid));
    tx.items.set('b_1:i_1', makeItem('b_1', 'i_1'));

    const res = await requestFileUploadInTransaction(
      tx,
      bucket,
      {
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        size: 1024 * 50,
      },
      uid,
    );

    expect(res.fileId).toBe('file_mock_123');
    expect(res.storagePath).toBe('boards/b_1/items/i_1/files/file_mock_123');
    expect(res.uploadUrl).toContain('image%2Fjpeg');
    expect(bucket.lastUploadSize).toBe(1024 * 50);
    expect(res.headers).toEqual({
      'content-type': 'image/jpeg',
      'x-goog-content-length-range': `0,${1024 * 50}`,
    });
  });

  it('rejects upload when file exceeds column size limit', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const uid = 'usr_1';

    tx.workspaces.set('ws_1', makeWorkspace(uid, 'owner'));
    tx.boards.set('b_1', makeBoard(uid));
    tx.items.set('b_1:i_1', makeItem('b_1', 'i_1'));

    await expect(
      requestFileUploadInTransaction(
        tx,
        bucket,
        {
          boardId: 'b_1',
          itemId: 'i_1',
          columnId: 'c_files',
          fileName: 'huge.pdf',
          contentType: 'application/pdf',
          size: 15 * 1024 * 1024, // 15 MB > 10 MB col limit
        },
        uid,
      ),
    ).rejects.toThrow(/exceeds column maximum of 10 MB/);
  });

  it('rejects upload when file extension/type is not allowed', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const uid = 'usr_1';

    tx.workspaces.set('ws_1', makeWorkspace(uid, 'owner'));
    tx.boards.set('b_1', makeBoard(uid));
    tx.items.set('b_1:i_1', makeItem('b_1', 'i_1'));

    await expect(
      requestFileUploadInTransaction(
        tx,
        bucket,
        {
          boardId: 'b_1',
          itemId: 'i_1',
          columnId: 'c_files',
          fileName: 'video.mp4',
          contentType: 'video/mp4',
          size: 1024 * 100,
        },
        uid,
      ),
    ).rejects.toThrow(/not allowed/);
  });

  it('rejects upload when user is removed from workspace', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const uid = 'usr_removed';

    const ws = makeWorkspace('other_uid', 'owner');
    tx.workspaces.set('ws_1', ws);

    const board = makeBoard('other_uid');
    board.access[uid] = 'editor';
    tx.boards.set('b_1', board);
    tx.items.set('b_1:i_1', makeItem('b_1', 'i_1'));

    await expect(
      requestFileUploadInTransaction(
        tx,
        bucket,
        {
          boardId: 'b_1',
          itemId: 'i_1',
          columnId: 'c_files',
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          size: 1024,
        },
        uid,
      ),
    ).rejects.toThrow(/access/i);
  });
});

describe('file-storage finalizeFileUpload', () => {
  it('successfully finalizes upload without deleting from storage', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const uid = 'usr_1';

    tx.workspaces.set('ws_1', makeWorkspace(uid, 'member'));
    tx.boards.set('b_1', makeBoard(uid));
    tx.items.set('b_1:i_1', makeItem('b_1', 'i_1'));

    const storagePath = 'boards/b_1/items/i_1/files/file_abc';
    bucket.files.set(storagePath, {
      size: 1024 * 500,
      contentType: 'application/pdf',
      timeCreated: '2026-10-25T00:00:00.000Z',
    });

    const res = await finalizeFileUploadInTransaction(
      tx,
      bucket,
      {
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'file_abc',
        fileName: 'Report.pdf',
      },
      uid,
    );

    expect(res.kind).toBe('success');
    if (res.kind === 'success') {
      expect(res.file.id).toBe('file_abc');
      expect(res.file.name).toBe('Report.pdf');
      expect(res.file.size).toBe(1024 * 500);
      expect(res.file.mimeType).toBe('application/pdf');
      expect(res.file.uploadedBy).toBe(uid);
      expect(res.columnValue.files).toHaveLength(1);
    }

    const updated = tx.updatedValues.get('b_1:i_1');
    expect(updated).toBeDefined();
    expect((updated?.['c_files'] as FilesValue).files[0]?.id).toBe('file_abc');
    expect(bucket.deletedFiles).toHaveLength(0);
  });

  it('returns rejected outcome with path to delete when validation fails (delete happens outside transaction)', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const uid = 'usr_1';

    tx.workspaces.set('ws_1', makeWorkspace(uid, 'owner'));
    tx.boards.set('b_1', makeBoard(uid));
    tx.items.set('b_1:i_1', makeItem('b_1', 'i_1'));

    const storagePath = 'boards/b_1/items/i_1/files/file_disallowed';
    bucket.files.set(storagePath, {
      size: 1024,
      contentType: 'application/zip', // Not allowed by settings
      timeCreated: '2026-10-25T00:00:00.000Z',
    });

    const outcome = await finalizeFileUploadInTransaction(
      tx,
      bucket,
      {
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'file_disallowed',
        fileName: 'archive.zip',
      },
      uid,
    );

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.storagePathToDelete).toBe(storagePath);
      expect(outcome.error.message).toMatch(/fails size .* or MIME type/);
    }
    // Delete must NOT run inside the transaction callback
    expect(bucket.deletedFiles).toHaveLength(0);

    // Caller deletes after transaction resolves
    if (outcome.kind === 'rejected') {
      await bucket.deleteFile(outcome.storagePathToDelete);
      expect(bucket.deletedFiles).toContain(storagePath);
    }
  });

  it('returns rejected outcome when 100-file cap is reached without deleting inside callback', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const uid = 'usr_1';

    tx.workspaces.set('ws_1', makeWorkspace(uid, 'owner'));
    tx.boards.set('b_1', makeBoard(uid));

    const item = makeItem('b_1', 'i_1');
    const filesArray = Array.from({ length: 100 }, (_, i) => ({
      id: `f_${i}`,
      name: `file_${i}.pdf`,
      storagePath: `boards/b_1/items/i_1/files/f_${i}`,
      size: 100,
      mimeType: 'application/pdf',
      uploadedAt: '2026-10-25T00:00:00.000Z',
      uploadedBy: uid,
    }));
    item.values = { c_files: { files: filesArray } };
    tx.items.set('b_1:i_1', item);

    const storagePath = 'boards/b_1/items/i_1/files/f_overflow';
    bucket.files.set(storagePath, {
      size: 100,
      contentType: 'application/pdf',
      timeCreated: '2026-10-25T00:00:00.000Z',
    });

    const outcome = await finalizeFileUploadInTransaction(
      tx,
      bucket,
      {
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'f_overflow',
        fileName: 'overflow.pdf',
      },
      uid,
    );

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.storagePathToDelete).toBe(storagePath);
      expect(outcome.error.message).toMatch(/Maximum files limit \(100\) reached/);
    }
    expect(bucket.deletedFiles).toHaveLength(0);
  });
});

describe('file-storage getFileDownloadUrl', () => {
  it('generates signed download URL for viewer', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const viewerUid = 'usr_viewer';

    const ws = makeWorkspace('owner_uid', 'owner');
    ws.memberIds.push(viewerUid);
    ws.roles[viewerUid] = 'viewer';
    tx.workspaces.set('ws_1', ws);

    const board = makeBoard('owner_uid');
    tx.boards.set('b_1', board);

    const item = makeItem('b_1', 'i_1');
    item.values = {
      c_files: {
        files: [
          {
            id: 'file_view',
            name: 'doc.pdf',
            storagePath: 'boards/b_1/items/i_1/files/file_view',
            size: 1024,
            mimeType: 'application/pdf',
            uploadedAt: '2026-10-25T00:00:00.000Z',
            uploadedBy: 'owner_uid',
          },
        ],
      },
    };
    tx.items.set('b_1:i_1', item);

    const res = await getFileDownloadUrlInTransaction(
      tx,
      bucket,
      {
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'file_view',
      },
      viewerUid,
    );

    expect(res.downloadUrl).toContain('boards/b_1/items/i_1/files/file_view?download=true');
    expect(res.expiresAt).toBe(1700000000 + 300);
  });

  it('refuses download when item state is deleted', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const uid = 'usr_1';

    tx.workspaces.set('ws_1', makeWorkspace(uid, 'owner'));
    tx.boards.set('b_1', makeBoard(uid));

    const item = makeItem('b_1', 'i_1', 'deleted');
    item.values = {
      c_files: {
        files: [
          {
            id: 'file_view',
            name: 'doc.pdf',
            storagePath: 'boards/b_1/items/i_1/files/file_view',
            size: 1024,
            mimeType: 'application/pdf',
            uploadedAt: '2026-10-25T00:00:00.000Z',
            uploadedBy: uid,
          },
        ],
      },
    };
    tx.items.set('b_1:i_1', item);

    await expect(
      getFileDownloadUrlInTransaction(
        tx,
        bucket,
        {
          boardId: 'b_1',
          itemId: 'i_1',
          columnId: 'c_files',
          fileId: 'file_view',
        },
        uid,
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses a forged cross-board storagePath and signs nothing', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    let signed = 0;
    const original = bucket.getSignedDownloadUrl.bind(bucket);
    bucket.getSignedDownloadUrl = async (...args) => {
      signed++;
      return original(...args);
    };
    const uid = 'usr_1';
    tx.workspaces.set('ws_1', makeWorkspace(uid, 'owner'));
    tx.boards.set('b_1', makeBoard(uid));
    const item = makeItem('b_1', 'i_1');
    item.values = {
      c_files: {
        files: [
          {
            id: 'file_forged',
            name: 'secret.pdf',
            storagePath: 'boards/b_other/items/i_x/files/file_secret',
            size: 1024,
            mimeType: 'application/pdf',
            uploadedAt: '2026-10-25T00:00:00.000Z',
            uploadedBy: uid,
          },
        ],
      },
    };
    tx.items.set('b_1:i_1', item);

    await expect(
      getFileDownloadUrlInTransaction(
        tx,
        bucket,
        { boardId: 'b_1', itemId: 'i_1', columnId: 'c_files', fileId: 'file_forged' },
        uid,
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(signed).toBe(0);
  });
});

describe('file-storage deleteFileAttachment', () => {
  it('removes file attachment from item and returns path for post-commit deletion', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const uid = 'usr_1';

    tx.workspaces.set('ws_1', makeWorkspace(uid, 'owner'));
    tx.boards.set('b_1', makeBoard(uid));

    const item = makeItem('b_1', 'i_1');
    const storagePath = 'boards/b_1/items/i_1/files/file_to_del';
    item.values = {
      c_files: {
        files: [
          {
            id: 'file_to_del',
            name: 'delete_me.pdf',
            storagePath,
            size: 2048,
            mimeType: 'application/pdf',
            uploadedAt: '2026-10-25T00:00:00.000Z',
            uploadedBy: uid,
          },
        ],
      },
    };
    tx.items.set('b_1:i_1', item);
    bucket.files.set(storagePath, {
      size: 2048,
      contentType: 'application/pdf',
      timeCreated: '2026-10-25T00:00:00.000Z',
    });

    const { result, storagePathToDelete } = await deleteFileAttachmentInTransaction(
      tx,
      {
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'file_to_del',
      },
      uid,
    );

    expect(result.success).toBe(true);
    expect(result.columnValue.files).toHaveLength(0);
    expect(storagePathToDelete).toBe(storagePath);
    // Delete did NOT run inside the transaction
    expect(bucket.deletedFiles).toHaveLength(0);

    // Caller deletes after transaction commit
    await bucket.deleteFile(storagePathToDelete);
    expect(bucket.deletedFiles).toContain(storagePath);
  });

  it('refuses a forged cross-board storagePath and leaves the cell untouched', async () => {
    const tx = new MockFileStorageTx();
    const uid = 'usr_1';
    tx.workspaces.set('ws_1', makeWorkspace(uid, 'owner'));
    tx.boards.set('b_1', makeBoard(uid));
    const item = makeItem('b_1', 'i_1');
    item.values = {
      c_files: {
        files: [
          {
            id: 'file_forged',
            name: 'victim.pdf',
            storagePath: 'boards/b_other/items/i_x/files/file_victim',
            size: 2048,
            mimeType: 'application/pdf',
            uploadedAt: '2026-10-25T00:00:00.000Z',
            uploadedBy: uid,
          },
        ],
      },
    };
    tx.items.set('b_1:i_1', item);

    await expect(
      deleteFileAttachmentInTransaction(
        tx,
        { boardId: 'b_1', itemId: 'i_1', columnId: 'c_files', fileId: 'file_forged' },
        uid,
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(tx.updatedValues.size).toBe(0);
  });
});

describe('file-storage sweepOrphanUploads', () => {
  it('deletes orphan uploads older than 1h and preserves referenced or recent files', async () => {
    const deletedFiles: string[] = [];
    const now = 1700000000000;
    const cutoff = now - 60 * 60 * 1000;

    const mockStore: OrphanSweeperStore = {
      async listUploadFiles() {
        return [
          // 1. Valid matching path, older than 1h, unreferenced -> DELETE
          {
            name: 'boards/b_1/items/i_1/files/orphan_old',
            timeCreated: new Date(cutoff - 1000).toISOString(),
          },
          // 2. Valid matching path, older than 1h, referenced -> KEEP
          {
            name: 'boards/b_1/items/i_1/files/referenced_old',
            timeCreated: new Date(cutoff - 5000).toISOString(),
          },
          // 3. Valid matching path, younger than 1h -> KEEP (in-progress upload)
          {
            name: 'boards/b_1/items/i_1/files/in_progress_recent',
            timeCreated: new Date(cutoff + 10000).toISOString(),
          },
          // 4. Non-matching path -> KEEP / IGNORE
          {
            name: 'other_folder/something.txt',
            timeCreated: new Date(cutoff - 10000).toISOString(),
          },
        ];
      },
      async isStoragePathReferenced(_boardId, _itemId, storagePath) {
        return storagePath === 'boards/b_1/items/i_1/files/referenced_old';
      },
      async deleteFile(storagePath) {
        deletedFiles.push(storagePath);
      },
    };

    const res = await sweepOrphanUploads(mockStore, cutoff);
    expect(res.scanned).toBe(4);
    expect(res.deleted).toBe(1);
    expect(deletedFiles).toEqual(['boards/b_1/items/i_1/files/orphan_old']);
  });
});

describe('file-storage column locks enforcement', () => {
  it('refuses requestFileUpload, finalizeFileUpload, and deleteFileAttachment for an editor on a locked column and allows a board owner, while keeping getFileDownloadUrl allowed', async () => {
    const tx = new MockFileStorageTx();
    const bucket = new MockStorageBucket();
    const ownerUid = 'usr_owner';
    const editorUid = 'usr_editor';
    const viewerUid = 'usr_viewer';

    const ws = makeWorkspace(ownerUid, 'owner');
    ws.memberIds.push(editorUid, viewerUid);
    ws.roles[editorUid] = 'member';
    ws.roles[viewerUid] = 'viewer';
    tx.workspaces.set('ws_1', ws);

    const board = makeBoard(ownerUid);
    board.columnLocks = ['c_files'];
    tx.boards.set('b_1', board);

    const item = makeItem('b_1', 'i_1');
    const existingPath = 'boards/b_1/items/i_1/files/file_existing';
    item.values = {
      c_files: {
        files: [
          {
            id: 'file_existing',
            name: 'existing.pdf',
            storagePath: existingPath,
            size: 1024,
            mimeType: 'application/pdf',
            uploadedAt: '2026-10-25T00:00:00.000Z',
            uploadedBy: ownerUid,
          },
        ],
      },
    };
    tx.items.set('b_1:i_1', item);

    const newPath = 'boards/b_1/items/i_1/files/file_new';
    bucket.files.set(newPath, {
      size: 1024,
      contentType: 'application/pdf',
      timeCreated: '2026-10-25T00:00:00.000Z',
    });

    // 1. requestFileUpload: editor refused, owner allowed
    await expect(
      requestFileUploadInTransaction(
        tx,
        bucket,
        {
          boardId: 'b_1',
          itemId: 'i_1',
          columnId: 'c_files',
          fileName: 'doc.pdf',
          contentType: 'application/pdf',
          size: 1024,
        },
        editorUid,
      ),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'This column is locked. Only board owners can edit it.',
    });

    const uploadReqRes = await requestFileUploadInTransaction(
      tx,
      bucket,
      {
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileName: 'doc.pdf',
        contentType: 'application/pdf',
        size: 1024,
      },
      ownerUid,
    );
    expect(uploadReqRes.fileId).toBe('file_mock_123');

    // 2. finalizeFileUpload: editor refused, owner allowed
    await expect(
      finalizeFileUploadInTransaction(
        tx,
        bucket,
        {
          boardId: 'b_1',
          itemId: 'i_1',
          columnId: 'c_files',
          fileId: 'file_new',
          fileName: 'new.pdf',
        },
        editorUid,
      ),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'This column is locked. Only board owners can edit it.',
    });

    const finalizeRes = await finalizeFileUploadInTransaction(
      tx,
      bucket,
      {
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'file_new',
        fileName: 'new.pdf',
      },
      ownerUid,
    );
    expect(finalizeRes.kind).toBe('success');

    // 3. getFileDownloadUrl: both editor and viewer are allowed on a locked column
    for (const uid of [editorUid, viewerUid]) {
      const dlRes = await getFileDownloadUrlInTransaction(
        tx,
        bucket,
        {
          boardId: 'b_1',
          itemId: 'i_1',
          columnId: 'c_files',
          fileId: 'file_existing',
        },
        uid,
      );
      expect(dlRes.downloadUrl).toContain(existingPath);
    }

    // 4. deleteFileAttachment: editor refused, owner allowed
    await expect(
      deleteFileAttachmentInTransaction(
        tx,
        {
          boardId: 'b_1',
          itemId: 'i_1',
          columnId: 'c_files',
          fileId: 'file_existing',
        },
        editorUid,
      ),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: 'This column is locked. Only board owners can edit it.',
    });

    const delRes = await deleteFileAttachmentInTransaction(
      tx,
      {
        boardId: 'b_1',
        itemId: 'i_1',
        columnId: 'c_files',
        fileId: 'file_existing',
      },
      ownerUid,
    );
    expect(delRes.result.success).toBe(true);
  });
});
