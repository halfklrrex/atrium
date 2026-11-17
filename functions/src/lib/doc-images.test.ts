import type { DocImage, WorkspaceRole } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  docImagePath,
  finalizeDocImageInTransaction,
  getDocImageUrlInTransaction,
  requestDocImageUploadInTransaction,
  type DocImageTx,
} from './doc-images';
import type { SharingEntity } from './entity-sharing';
import {
  sweepOrphanUploads,
  type FileStorageBucket,
  type OrphanSweeperStore,
  type StorageFileMetadata,
} from './file-storage';

const uid = 'usr_1';

class FakeTx implements DocImageTx {
  written: Array<{ fileId: string; image: DocImage }> = [];
  constructor(
    public doc: SharingEntity | null,
    public roles: Record<string, WorkspaceRole> | null,
    public images: unknown = undefined,
  ) {}
  async getDoc() {
    return this.doc;
  }
  async getWorkspaceRoles() {
    return this.roles;
  }
  async getImages() {
    return this.images;
  }
  generateFileId() {
    return 'img_1';
  }
  setImage(_d: string, fileId: string, image: DocImage) {
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

const mainDoc = (extra: Partial<SharingEntity> = {}): SharingEntity => ({
  workspaceId: 'ws_1',
  kind: 'main',
  access: { owner_1: 'owner' },
  state: 'active',
  ...extra,
});

const upload = { docId: 'd_1', fileName: 'a.png', contentType: 'image/png', size: 1000 };

function setup(role: WorkspaceRole = 'owner', doc: SharingEntity | null = mainDoc()) {
  return { tx: new FakeTx(doc, { [uid]: role }), bucket: new FakeBucket() };
}

const image: DocImage = {
  name: 'a.png',
  size: 1,
  mimeType: 'image/png',
  uploadedAt: '2026-11-17T00:00:00.000Z',
  uploadedBy: uid,
};

describe('docImagePath', () => {
  it('builds the canonical path and refuses unsafe ids', () => {
    expect(docImagePath('d_1', 'f_1')).toBe('docs/d_1/images/f_1');
    expect(() => docImagePath('../x', 'f')).toThrow();
    expect(() => docImagePath('d', 'a/b')).toThrow();
  });
});

describe('requestDocImageUpload', () => {
  it('signs a 10-minute PUT for the canonical doc image path', async () => {
    const { tx, bucket } = setup();
    const res = await requestDocImageUploadInTransaction(tx, bucket, upload, uid);
    expect(res.fileId).toBe('img_1');
    expect(bucket.signedPaths).toEqual(['docs/d_1/images/img_1']);
    expect(res.expiresAt).toBe(1700000000 + 600);
    expect(res.headers['x-goog-content-length-range']).toBe('0,1000');
  });

  it('allows a doc editor and refuses a viewer', async () => {
    const editor = setup('member');
    await expect(
      requestDocImageUploadInTransaction(editor.tx, editor.bucket, upload, uid),
    ).resolves.toBeTruthy();
    const viewer = setup('viewer');
    await expect(
      requestDocImageUploadInTransaction(viewer.tx, viewer.bucket, upload, uid),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('follows the doc access: a private doc hides it from a workspace owner without a role', async () => {
    const { tx, bucket } = setup(
      'owner',
      mainDoc({ kind: 'private', access: { owner_1: 'owner' } }),
    );
    await expect(requestDocImageUploadInTransaction(tx, bucket, upload, uid)).rejects.toMatchObject(
      { code: 'permission-denied' },
    );
    // An explicit viewer role on a private doc can read but not upload.
    const viewer = setup('member', mainDoc({ kind: 'private', access: { [uid]: 'viewer' } }));
    await expect(
      requestDocImageUploadInTransaction(viewer.tx, viewer.bucket, upload, uid),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(bucket.signedPaths).toEqual([]);
  });

  it('refuses a non-member and a missing doc', async () => {
    const outsider = new FakeTx(mainDoc(), {});
    await expect(
      requestDocImageUploadInTransaction(outsider, new FakeBucket(), upload, uid),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    const missing = setup('owner', null);
    await expect(
      requestDocImageUploadInTransaction(missing.tx, missing.bucket, upload, uid),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('refuses a deleted doc, a wrong type, a file over 10 MB and a doc at 100 images', async () => {
    const trashed = setup('owner', mainDoc({ state: 'deleted' }));
    await expect(
      requestDocImageUploadInTransaction(trashed.tx, trashed.bucket, upload, uid),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const { tx, bucket } = setup();
    await expect(
      requestDocImageUploadInTransaction(
        tx,
        bucket,
        { ...upload, contentType: 'image/svg+xml' },
        uid,
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      requestDocImageUploadInTransaction(
        tx,
        bucket,
        { ...upload, size: 10 * 1024 * 1024 + 1 },
        uid,
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    tx.images = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`f${i}`, image]));
    await expect(requestDocImageUploadInTransaction(tx, bucket, upload, uid)).rejects.toMatchObject(
      { code: 'failed-precondition' },
    );
    expect(bucket.signedPaths).toEqual([]);
  });

  it('refuses a corrupt stored map', async () => {
    const { tx, bucket } = setup();
    tx.images = { f1: { name: 1 } };
    await expect(requestDocImageUploadInTransaction(tx, bucket, upload, uid)).rejects.toMatchObject(
      { code: 'failed-precondition' },
    );
  });
});

describe('finalizeDocImage', () => {
  const finalize = { docId: 'd_1', fileId: 'img_1', fileName: 'a.png' };
  const pathOf = 'docs/d_1/images/img_1';
  const withFile = (size: number, contentType: string) =>
    new FakeBucket(
      new Map([[pathOf, { size, contentType, timeCreated: '2026-11-17T00:00:00.000Z' }]]),
    );

  it('records the image from Storage metadata, not from the client', async () => {
    const { tx } = setup();
    const bucket = withFile(2048, 'image/webp');
    const out = await finalizeDocImageInTransaction(
      tx,
      bucket,
      finalize,
      uid,
      '2026-11-17T01:00:00.000Z',
    );
    expect(out.kind).toBe('success');
    expect(tx.written).toEqual([
      {
        fileId: 'img_1',
        image: {
          name: 'a.png',
          size: 2048,
          mimeType: 'image/webp',
          uploadedAt: '2026-11-17T01:00:00.000Z',
          uploadedBy: uid,
        },
      },
    ]);
  });

  it('refuses a viewer, a missing object and a duplicate', async () => {
    const viewer = setup('viewer');
    await expect(
      finalizeDocImageInTransaction(viewer.tx, withFile(1, 'image/png'), finalize, uid),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    const { tx } = setup();
    await expect(
      finalizeDocImageInTransaction(tx, new FakeBucket(), finalize, uid),
    ).rejects.toMatchObject({ code: 'not-found' });
    tx.images = { img_1: image };
    await expect(
      finalizeDocImageInTransaction(tx, withFile(1, 'image/png'), finalize, uid),
    ).rejects.toMatchObject({ code: 'already-exists' });
    expect(tx.written).toEqual([]);
  });

  it('rejects and asks to delete a wrong type, an oversize file and a 101st image', async () => {
    for (const [size, type] of [
      [1, 'text/html'],
      [10 * 1024 * 1024 + 1, 'image/png'],
    ] as const) {
      const { tx } = setup();
      const out = await finalizeDocImageInTransaction(tx, withFile(size, type), finalize, uid);
      expect(out).toMatchObject({ kind: 'rejected', storagePathToDelete: pathOf });
      expect(tx.written).toEqual([]);
    }
    const { tx } = setup();
    tx.images = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`f${i}`, image]));
    const out = await finalizeDocImageInTransaction(tx, withFile(1, 'image/png'), finalize, uid);
    expect(out).toMatchObject({ kind: 'rejected', storagePathToDelete: pathOf });
  });

  it('refuses a deleted doc', async () => {
    const { tx } = setup('owner', mainDoc({ state: 'deleted' }));
    await expect(
      finalizeDocImageInTransaction(tx, withFile(1, 'image/png'), finalize, uid),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('getDocImageUrl', () => {
  const get = { docId: 'd_1', fileId: 'img_1' };

  it('gives readers, viewers included, a one-hour URL for a listed image', async () => {
    const { tx, bucket } = setup('viewer');
    tx.images = { img_1: image };
    const res = await getDocImageUrlInTransaction(tx, bucket, get, uid);
    expect(res.expiresAt).toBe(3600);
    expect(bucket.signedPaths).toEqual(['docs/d_1/images/img_1']);
  });

  it('refuses an unlisted image, an outsider and a deleted doc', async () => {
    const { tx, bucket } = setup();
    await expect(getDocImageUrlInTransaction(tx, bucket, get, uid)).rejects.toMatchObject({
      code: 'not-found',
    });
    tx.images = { img_1: image };
    tx.roles = {};
    await expect(getDocImageUrlInTransaction(tx, bucket, get, uid)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    const trashed = setup('owner', mainDoc({ state: 'deleted' }));
    trashed.tx.images = { img_1: image };
    await expect(
      getDocImageUrlInTransaction(trashed.tx, trashed.bucket, get, uid),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(bucket.signedPaths).toEqual([]);
  });
});

describe('sweepOrphanUploads and doc images', () => {
  it('deletes unlisted doc images older than the cutoff and keeps listed or recent ones', async () => {
    const cutoff = 1700000000000;
    const old = new Date(cutoff - 1000).toISOString();
    const deleted: string[] = [];
    const store: OrphanSweeperStore = {
      async listUploadFiles() {
        return [
          { name: 'docs/d_1/images/orphan', timeCreated: old },
          { name: 'docs/d_1/images/listed', timeCreated: old },
          { name: 'docs/d_1/images/fresh', timeCreated: new Date(cutoff + 1000).toISOString() },
          { name: 'docs/d_1/other/thing', timeCreated: old },
        ];
      },
      async isStoragePathReferenced() {
        throw new Error('doc images are not looked up by item');
      },
      async isDocImageReferenced(_docId, fileId) {
        return fileId === 'listed';
      },
      async deleteFile(path) {
        deleted.push(path);
      },
    };
    const res = await sweepOrphanUploads(store, cutoff);
    expect(res).toEqual({ scanned: 4, deleted: 1 });
    expect(deleted).toEqual(['docs/d_1/images/orphan']);
  });

  it('leaves doc images alone when the store cannot look them up', async () => {
    const deleted: string[] = [];
    const store: OrphanSweeperStore = {
      async listUploadFiles() {
        return [{ name: 'docs/d_1/images/x', timeCreated: '2020-01-01T00:00:00.000Z' }];
      },
      async isStoragePathReferenced() {
        return false;
      },
      async deleteFile(path) {
        deleted.push(path);
      },
    };
    expect(await sweepOrphanUploads(store, 1700000000000)).toEqual({ scanned: 1, deleted: 0 });
    expect(deleted).toEqual([]);
  });
});
