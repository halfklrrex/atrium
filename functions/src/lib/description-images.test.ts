import {
  descriptionImagesSchema,
  finalizeDescriptionImageRequestSchema,
  getDescriptionImageUrlRequestSchema,
  requestDescriptionImageUploadRequestSchema,
} from '@atrium/shared';
import type { Board, DescriptionImage, Item, Workspace, WorkspaceRole } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  descriptionImagePath,
  finalizeDescriptionImageInTransaction,
  getDescriptionImageUrlInTransaction,
  requestDescriptionImageUploadInTransaction,
  type DescriptionImageTx,
} from './description-images';
import {
  sweepOrphanUploads,
  type FileStorageBucket,
  type OrphanSweeperStore,
  type StorageFileMetadata,
} from './file-storage';

const ts = {
  seconds: 1700000000,
  nanoseconds: 0,
  toDate: () => new Date('2026-10-25T00:00:00Z'),
  toMillis: () => 1700000000000,
};

function makeBoard(uid: string): Board {
  return {
    workspaceId: 'ws_1',
    folderId: null,
    name: 'Test Board',
    description: '',
    kind: 'main',
    access: { [uid]: 'owner' },
    accessUids: [uid],
    position: 'a0',
    icon: null,
    columns: [],
    subitemColumns: [],
    derivedColumnIds: [],
    serverManagedColumnIds: [],
    groups: [],
    itemTerminology: 'item',
    state: 'active',
    deletedAt: null,
    createdAt: ts,
    createdBy: uid,
    updatedAt: ts,
  } as unknown as Board;
}

function makeWorkspace(uid: string, role: WorkspaceRole): Workspace {
  return {
    name: 'Test WS',
    description: '',
    icon: 'T',
    color: '#6161ff',
    ownerId: 'owner_1',
    memberIds: [uid],
    roles: { [uid]: role },
    kind: 'open',
    createdAt: ts,
    createdBy: 'owner_1',
    updatedAt: ts,
  } as unknown as Workspace;
}

function makeItem(extra: Partial<Item> = {}): Item {
  return {
    name: 'Item',
    groupId: 'g_1',
    position: 'a0',
    parentItemId: null,
    values: {},
    state: 'active',
    deletedAt: null,
    createdAt: ts,
    createdBy: 'usr_1',
    updatedAt: ts,
    updatedBy: 'usr_1',
    ...extra,
  } as Item;
}

class FakeTx implements DescriptionImageTx {
  written: Array<{ fileId: string; image: DescriptionImage }> = [];
  constructor(
    public board: Board | null,
    private workspace: Workspace | null,
    private item: Item | null,
  ) {}
  async getBoard() {
    return this.board;
  }
  async getWorkspace() {
    return this.workspace;
  }
  async getItem() {
    return this.item;
  }
  updateItemValues(): void {
    throw new Error('description images never touch values');
  }
  generateFileId() {
    return 'img_1';
  }
  setDescriptionImage(_b: string, _i: string, fileId: string, image: DescriptionImage) {
    this.written.push({ fileId, image });
  }
}

class FakeBucket implements FileStorageBucket {
  deleted: string[] = [];
  signedPaths: string[] = [];
  constructor(private files: Map<string, StorageFileMetadata> = new Map()) {}
  async getFileMetadata(path: string) {
    return this.files.get(path) ?? null;
  }
  async deleteFile(path: string) {
    this.deleted.push(path);
  }
  async getSignedUploadUrl(path: string, contentType: string, size: number, seconds: number) {
    this.signedPaths.push(path);
    return {
      uploadUrl: `https://storage.mock.local/${path}`,
      expiresAt: 1700000000 + seconds,
      headers: { 'content-type': contentType, 'x-goog-content-length-range': `0,${size}` },
    };
  }
  async getSignedDownloadUrl(path: string, seconds: number) {
    this.signedPaths.push(path);
    return { downloadUrl: `https://storage.mock.local/${path}?get=1`, expiresAt: seconds };
  }
}

const uid = 'usr_1';
const upload = {
  boardId: 'b_1',
  itemId: 'i_1',
  fileName: 'a.png',
  contentType: 'image/png',
  size: 1000,
};

function setup(role: WorkspaceRole = 'owner', item: Item | null = makeItem()) {
  return {
    tx: new FakeTx(makeBoard(uid), makeWorkspace(uid, role), item),
    bucket: new FakeBucket(),
  };
}

const image: DescriptionImage = {
  name: 'a.png',
  size: 1,
  mimeType: 'image/png',
  uploadedAt: '2026-10-25T00:00:00.000Z',
  uploadedBy: uid,
};

describe('requestDescriptionImageUpload', () => {
  it('signs a 10-minute PUT for the canonical description path', async () => {
    const { tx, bucket } = setup();
    const res = await requestDescriptionImageUploadInTransaction(tx, bucket, upload, uid);
    expect(res.fileId).toBe('img_1');
    expect(bucket.signedPaths).toEqual(['boards/b_1/items/i_1/description/img_1']);
    expect(res.expiresAt).toBe(1700000000 + 600);
    expect(res.headers['x-goog-content-length-range']).toBe('0,1000');
  });

  it('refuses a user who is not a member of the workspace', async () => {
    const { tx, bucket } = setup();
    tx.board = { ...makeBoard('someone_else'), kind: 'private' } as Board;
    await expect(
      requestDescriptionImageUploadInTransaction(tx, bucket, upload, uid),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(bucket.signedPaths).toEqual([]);
  });

  it('refuses a viewer (read-only role) on upload', async () => {
    const { tx, bucket } = setup('viewer');
    tx.board = { ...makeBoard('someone_else'), kind: 'main', access: {} } as Board;
    await expect(
      requestDescriptionImageUploadInTransaction(tx, bucket, upload, uid),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('refuses a wrong type, a file over 10 MB and an item at 50 images', async () => {
    const { tx, bucket } = setup();
    await expect(
      requestDescriptionImageUploadInTransaction(
        tx,
        bucket,
        { ...upload, contentType: 'image/svg+xml' },
        uid,
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      requestDescriptionImageUploadInTransaction(
        tx,
        bucket,
        { ...upload, size: 10 * 1024 * 1024 + 1 },
        uid,
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    const full: Record<string, DescriptionImage> = {};
    for (let n = 0; n < 50; n++) full[`f${n}`] = image;
    const crowded = setup('owner', makeItem({ descriptionImages: full }));
    await expect(
      requestDescriptionImageUploadInTransaction(crowded.tx, crowded.bucket, upload, uid),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('refuses an archived item', async () => {
    const { tx, bucket } = setup('owner', makeItem({ state: 'archived' }));
    await expect(
      requestDescriptionImageUploadInTransaction(tx, bucket, upload, uid),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('finalizeDescriptionImage', () => {
  const finalize = { boardId: 'b_1', itemId: 'i_1', fileId: 'img_1', fileName: 'a.png' };
  const path = 'boards/b_1/items/i_1/description/img_1';

  it('rejects a missing object', async () => {
    const { tx, bucket } = setup();
    await expect(
      finalizeDescriptionImageInTransaction(tx, bucket, finalize, uid),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(tx.written).toEqual([]);
  });

  it('writes the field path from the stored metadata', async () => {
    const { tx } = setup();
    const bucket = new FakeBucket(
      new Map([[path, { size: 1234, contentType: 'image/webp', timeCreated: 'x' }]]),
    );
    const out = await finalizeDescriptionImageInTransaction(
      tx,
      bucket,
      finalize,
      uid,
      '2026-10-25T00:00:00.000Z',
    );
    expect(out.kind).toBe('success');
    expect(tx.written).toEqual([
      {
        fileId: 'img_1',
        image: {
          name: 'a.png',
          size: 1234,
          mimeType: 'image/webp',
          uploadedAt: '2026-10-25T00:00:00.000Z',
          uploadedBy: uid,
        },
      },
    ]);
  });

  it('returns a rejected outcome (deleted after the transaction) for a non-image', async () => {
    const { tx } = setup();
    const bucket = new FakeBucket(
      new Map([[path, { size: 10, contentType: 'text/html', timeCreated: 'x' }]]),
    );
    const out = await finalizeDescriptionImageInTransaction(tx, bucket, finalize, uid);
    expect(out).toMatchObject({ kind: 'rejected', storagePathToDelete: path });
    expect(bucket.deleted).toEqual([]);
    expect(tx.written).toEqual([]);
  });

  it('returns a rejected outcome for an oversized object', async () => {
    const { tx } = setup();
    const bucket = new FakeBucket(
      new Map([[path, { size: 11 * 1024 * 1024, contentType: 'image/png', timeCreated: 'x' }]]),
    );
    const out = await finalizeDescriptionImageInTransaction(tx, bucket, finalize, uid);
    expect(out.kind).toBe('rejected');
  });
});

describe('getDescriptionImageUrl', () => {
  const request = { boardId: 'b_1', itemId: 'i_1', fileId: 'img_1' };

  it('signs a one-hour GET for a listed image', async () => {
    const { tx, bucket } = setup('viewer', makeItem({ descriptionImages: { img_1: image } }));
    const res = await getDescriptionImageUrlInTransaction(tx, bucket, request, uid);
    expect(res.url).toContain('/description/img_1');
    expect(res.expiresAt).toBe(3600);
  });

  it('refuses an unknown fileId', async () => {
    const { tx, bucket } = setup('owner', makeItem({ descriptionImages: { other: image } }));
    await expect(
      getDescriptionImageUrlInTransaction(tx, bucket, request, uid),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(bucket.signedPaths).toEqual([]);
  });

  it('refuses a deleted item', async () => {
    const { tx, bucket } = setup(
      'owner',
      makeItem({ state: 'deleted', descriptionImages: { img_1: image } }),
    );
    await expect(
      getDescriptionImageUrlInTransaction(tx, bucket, request, uid),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('strict ids', () => {
  const bad = ['../x', 'a/b', '.', '..', '', 'a b'];

  it('rejects traversal ids in the request schemas', () => {
    for (const id of bad) {
      expect(
        requestDescriptionImageUploadRequestSchema.safeParse({ ...upload, boardId: id }).success,
      ).toBe(false);
      expect(
        requestDescriptionImageUploadRequestSchema.safeParse({ ...upload, itemId: id }).success,
      ).toBe(false);
      const fin = { boardId: 'b_1', itemId: 'i_1', fileId: 'f', fileName: 'a.png' };
      expect(finalizeDescriptionImageRequestSchema.safeParse({ ...fin, fileId: id }).success).toBe(
        false,
      );
      expect(
        getDescriptionImageUrlRequestSchema.safeParse({ boardId: 'b', itemId: 'i', fileId: id })
          .success,
      ).toBe(false);
      expect(descriptionImagesSchema.safeParse({ [id]: image }).success).toBe(false);
    }
  });

  it('descriptionImagePath refuses unsafe segments', () => {
    for (const id of bad) {
      expect(() => descriptionImagePath(id, 'i', 'f')).toThrow();
      expect(() => descriptionImagePath('b', id, 'f')).toThrow();
      expect(() => descriptionImagePath('b', 'i', id)).toThrow();
    }
    expect(descriptionImagePath('b_1', 'i-1', 'f9')).toBe('boards/b_1/items/i-1/description/f9');
  });

  it('finalize with a traversal fileId touches no storage object', async () => {
    const { tx } = setup();
    const bucket = new FakeBucket();
    await expect(
      finalizeDescriptionImageInTransaction(
        tx,
        bucket,
        { boardId: 'b_1', itemId: 'i_1', fileId: '../../i_2/files/x', fileName: 'a.png' },
        uid,
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(bucket.deleted).toEqual([]);
  });
});

describe('sweepOrphanUploads and description images', () => {
  it('deletes unreferenced description objects and keeps referenced or recent ones', async () => {
    const cutoff = 1700000000000;
    const old = new Date(cutoff - 1000).toISOString();
    const deleted: string[] = [];
    const store: OrphanSweeperStore = {
      async listUploadFiles() {
        return [
          { name: 'boards/b_1/items/i_1/description/orphan', timeCreated: old },
          { name: 'boards/b_1/items/i_1/description/listed', timeCreated: old },
          {
            name: 'boards/b_1/items/i_1/description/fresh',
            timeCreated: new Date(cutoff + 1000).toISOString(),
          },
        ];
      },
      async isStoragePathReferenced(_b, _i, path) {
        return path.endsWith('/listed');
      },
      async deleteFile(path) {
        deleted.push(path);
      },
    };
    const res = await sweepOrphanUploads(store, cutoff);
    expect(res).toEqual({ scanned: 3, deleted: 1 });
    expect(deleted).toEqual(['boards/b_1/items/i_1/description/orphan']);
  });
});
