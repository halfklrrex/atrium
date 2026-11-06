import type { Board, FileAttachment, Item, Workspace, WorkspaceRole } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import {
  sweepOrphanUploads,
  type FileStorageBucket,
  type OrphanSweeperStore,
  type StorageFileMetadata,
} from './file-storage';
import {
  contentDispositionFor,
  deleteUpdateAttachmentInTransaction,
  finalizeUpdateAttachmentInTransaction,
  getUpdateAttachmentUrlInTransaction,
  isUpdateAttachmentReferenced,
  requestUpdateAttachmentUploadInTransaction,
  updateAttachmentPath,
  type UpdateAttachmentTx,
  type UpdatePostDoc,
} from './update-attachments';

const MB = 1024 * 1024;
const AUTHOR = 'usr_author';
const OTHER_EDITOR = 'usr_editor';
const BOARD_OWNER = 'usr_owner';
const VIEWER = 'usr_viewer';

class MockTx implements UpdateAttachmentTx {
  boards = new Map<string, Board>();
  workspaces = new Map<string, Workspace>();
  items = new Map<string, Item>();
  posts = new Map<string, UpdatePostDoc>();
  writes: Array<{ key: string; attachments: FileAttachment[] }> = [];

  async getBoard(id: string) {
    return this.boards.get(id) ?? null;
  }
  async getWorkspace(id: string) {
    return this.workspaces.get(id) ?? null;
  }
  async getItem(boardId: string, itemId: string) {
    return this.items.get(`${boardId}:${itemId}`) ?? null;
  }
  updateItemValues(): void {
    throw new Error('not used');
  }
  generateFileId() {
    return 'file_new';
  }
  async getPost(boardId: string, itemId: string, updateId: string, replyId?: string) {
    return this.posts.get(postKey(boardId, itemId, updateId, replyId)) ?? null;
  }
  setAttachments(
    boardId: string,
    itemId: string,
    updateId: string,
    replyId: string | undefined,
    attachments: FileAttachment[],
  ) {
    const key = postKey(boardId, itemId, updateId, replyId);
    this.writes.push({ key, attachments });
    const post = this.posts.get(key);
    if (post) post.attachments = attachments;
  }
}

const postKey = (b: string, i: string, u: string, r?: string) =>
  `${b}/${i}/${u}${r === undefined ? '' : `/${r}`}`;

class MockBucket implements FileStorageBucket {
  deleted: string[] = [];
  signedUploads: Array<{ path: string; size: number }> = [];
  signedDownloads: Array<{ path: string; expires: number; disposition?: string | undefined }> = [];
  constructor(public files = new Map<string, StorageFileMetadata>()) {}
  async getFileMetadata(path: string) {
    return this.files.get(path) ?? null;
  }
  async deleteFile(path: string) {
    this.deleted.push(path);
    this.files.delete(path);
  }
  async getSignedUploadUrl(path: string, contentType: string, size: number, secs: number) {
    this.signedUploads.push({ path, size });
    return {
      uploadUrl: `https://storage.mock.local/${path}`,
      expiresAt: 1_700_000_000 + secs,
      headers: { 'content-type': contentType, 'x-goog-content-length-range': `0,${size}` },
    };
  }
  async getSignedDownloadUrl(
    path: string,
    secs: number,
    options?: { contentDisposition?: string },
  ) {
    this.signedDownloads.push({ path, expires: secs, disposition: options?.contentDisposition });
    return {
      downloadUrl: `https://storage.mock.local/${path}?get`,
      expiresAt: 1_700_000_000 + secs,
    };
  }
}

const ts = { seconds: 1, nanoseconds: 0, toDate: () => new Date(0), toMillis: () => 0 };

function setup(opts: { itemState?: 'active' | 'archived' | 'deleted' } = {}) {
  const tx = new MockTx();
  const wsRoles: Record<string, WorkspaceRole> = {
    [BOARD_OWNER]: 'owner',
    [AUTHOR]: 'member',
    [OTHER_EDITOR]: 'member',
    [VIEWER]: 'viewer',
  };
  tx.workspaces.set('ws_1', {
    name: 'WS',
    description: '',
    icon: 'T',
    color: '#000000',
    ownerId: BOARD_OWNER,
    memberIds: Object.keys(wsRoles),
    roles: wsRoles,
    kind: 'open',
    createdAt: ts,
    createdBy: BOARD_OWNER,
    updatedAt: ts,
  } as unknown as Workspace);
  tx.boards.set('b_1', {
    workspaceId: 'ws_1',
    name: 'B',
    kind: 'main',
    access: {},
    accessUids: [],
    columns: [],
    state: 'active',
  } as unknown as Board);
  tx.items.set('b_1:i_1', { name: 'I', state: opts.itemState ?? 'active', values: {} } as Item);
  tx.posts.set(postKey('b_1', 'i_1', 'u_1'), { authorId: AUTHOR });
  tx.posts.set(postKey('b_1', 'i_1', 'u_1', 'r_1'), { authorId: AUTHOR });
  return { tx, bucket: new MockBucket() };
}

const target = { boardId: 'b_1', itemId: 'i_1', updateId: 'u_1' };
const replyTarget = { ...target, replyId: 'r_1' };
const upload = { fileName: 'plan.pdf', contentType: 'application/pdf', size: 1 * MB };

const attachment = (
  id: string,
  path = `boards/b_1/items/i_1/updates/u_1/${id}`,
): FileAttachment => ({
  id,
  name: `${id}.pdf`,
  storagePath: path,
  size: 100,
  mimeType: 'application/pdf',
  uploadedAt: '2026-11-05T00:00:00.000Z',
  uploadedBy: AUTHOR,
});

describe('updateAttachmentPath', () => {
  it('lays out update and reply objects and refuses unsafe ids', () => {
    expect(updateAttachmentPath(target, 'f1')).toBe('boards/b_1/items/i_1/updates/u_1/f1');
    expect(updateAttachmentPath(replyTarget, 'f1')).toBe(
      'boards/b_1/items/i_1/updates/u_1/replies/r_1/f1',
    );
    expect(() => updateAttachmentPath({ ...target, updateId: '../x' }, 'f1')).toThrow();
    expect(() => updateAttachmentPath(target, 'a/b')).toThrow();
    expect(() => updateAttachmentPath({ ...target, replyId: '..' }, 'f1')).toThrow();
  });
});

describe('requestUpdateAttachmentUpload', () => {
  it('signs an upload for the author of an update and of a reply, at the right path', async () => {
    const { tx, bucket } = setup();
    const res = await requestUpdateAttachmentUploadInTransaction(
      tx,
      bucket,
      { ...target, ...upload },
      AUTHOR,
    );
    expect(res.fileId).toBe('file_new');
    expect(res.headers['x-goog-content-length-range']).toBe(`0,${upload.size}`);
    const reply = await requestUpdateAttachmentUploadInTransaction(
      tx,
      bucket,
      { ...replyTarget, ...upload },
      AUTHOR,
    );
    expect(reply.fileId).toBe('file_new');
    expect(bucket.signedUploads.map((u) => u.path)).toEqual([
      'boards/b_1/items/i_1/updates/u_1/file_new',
      'boards/b_1/items/i_1/updates/u_1/replies/r_1/file_new',
    ]);
  });

  it('refuses a non-author editor, even a board owner, and a viewer', async () => {
    const { tx, bucket } = setup();
    for (const uid of [OTHER_EDITOR, BOARD_OWNER, VIEWER]) {
      await expect(
        requestUpdateAttachmentUploadInTransaction(tx, bucket, { ...target, ...upload }, uid),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect(bucket.signedUploads).toHaveLength(0);
  });

  it('refuses a stranger outside the workspace', async () => {
    const { tx, bucket } = setup();
    await expect(
      requestUpdateAttachmentUploadInTransaction(tx, bucket, { ...target, ...upload }, 'stranger'),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('refuses a missing update or reply, and an archived or deleted item', async () => {
    const { tx, bucket } = setup();
    await expect(
      requestUpdateAttachmentUploadInTransaction(
        tx,
        bucket,
        { ...target, updateId: 'ghost', ...upload },
        AUTHOR,
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      requestUpdateAttachmentUploadInTransaction(
        tx,
        bucket,
        { ...replyTarget, replyId: 'ghost', ...upload },
        AUTHOR,
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
    for (const itemState of ['archived', 'deleted'] as const) {
      const s = setup({ itemState });
      await expect(
        requestUpdateAttachmentUploadInTransaction(
          s.tx,
          s.bucket,
          { ...target, ...upload },
          AUTHOR,
        ),
      ).rejects.toBeTruthy();
    }
  });

  it('refuses a file over 25 MB and accepts exactly 25 MB', async () => {
    const { tx, bucket } = setup();
    await expect(
      requestUpdateAttachmentUploadInTransaction(
        tx,
        bucket,
        { ...target, ...upload, size: 25 * MB + 1 },
        AUTHOR,
      ),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      requestUpdateAttachmentUploadInTransaction(
        tx,
        bucket,
        { ...target, ...upload, size: 25 * MB },
        AUTHOR,
      ),
    ).resolves.toBeTruthy();
  });

  it('refuses an eleventh attachment', async () => {
    const { tx, bucket } = setup();
    tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments = Array.from({ length: 10 }, (_, i) =>
      attachment(`f${i}`),
    );
    await expect(
      requestUpdateAttachmentUploadInTransaction(tx, bucket, { ...target, ...upload }, AUTHOR),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('refuses a corrupt stored attachments value', async () => {
    const { tx, bucket } = setup();
    tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments = 'nope';
    await expect(
      requestUpdateAttachmentUploadInTransaction(tx, bucket, { ...target, ...upload }, AUTHOR),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('finalizeUpdateAttachment', () => {
  const stored = (over: Partial<StorageFileMetadata> = {}): StorageFileMetadata => ({
    size: 5000,
    contentType: 'application/pdf',
    timeCreated: '2026-11-05T10:00:00.000Z',
    ...over,
  });
  const req = { ...target, fileId: 'file_new', fileName: 'Plan.pdf' };
  const path = 'boards/b_1/items/i_1/updates/u_1/file_new';

  it('verifies the object and appends it once, without deleting anything', async () => {
    const { tx, bucket } = setup();
    bucket.files.set(path, stored());
    const out = await finalizeUpdateAttachmentInTransaction(tx, bucket, req, AUTHOR);
    expect(out.kind).toBe('success');
    if (out.kind !== 'success') return;
    expect(out.result.attachment).toMatchObject({
      id: 'file_new',
      name: 'Plan.pdf',
      storagePath: path,
      size: 5000,
      mimeType: 'application/pdf',
      uploadedAt: '2026-11-05T10:00:00.000Z',
      uploadedBy: AUTHOR,
    });
    expect(tx.writes).toHaveLength(1);
    expect(tx.writes[0]!.attachments.map((a) => a.id)).toEqual(['file_new']);
    expect(bucket.deleted).toEqual([]);
  });

  it('appends to a reply at the reply path', async () => {
    const { tx, bucket } = setup();
    bucket.files.set('boards/b_1/items/i_1/updates/u_1/replies/r_1/file_new', stored());
    const out = await finalizeUpdateAttachmentInTransaction(
      tx,
      bucket,
      { ...replyTarget, fileId: 'file_new', fileName: 'Plan.pdf' },
      AUTHOR,
    );
    expect(out.kind).toBe('success');
    expect(tx.writes[0]!.key).toBe('b_1/i_1/u_1/r_1');
  });

  it('is a no-op on a repeat finalize', async () => {
    const { tx, bucket } = setup();
    bucket.files.set(path, stored());
    await finalizeUpdateAttachmentInTransaction(tx, bucket, req, AUTHOR);
    const again = await finalizeUpdateAttachmentInTransaction(tx, bucket, req, AUTHOR);
    expect(again.kind).toBe('success');
    expect(tx.writes).toHaveLength(1);
    expect(tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments).toHaveLength(1);
    expect(bucket.deleted).toEqual([]);
  });

  it('refuses a non-author and a viewer', async () => {
    const { tx, bucket } = setup();
    bucket.files.set(path, stored());
    for (const uid of [OTHER_EDITOR, BOARD_OWNER, VIEWER]) {
      await expect(
        finalizeUpdateAttachmentInTransaction(tx, bucket, req, uid),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect(tx.writes).toHaveLength(0);
  });

  it('throws not-found when nothing was uploaded', async () => {
    const { tx, bucket } = setup();
    await expect(
      finalizeUpdateAttachmentInTransaction(tx, bucket, req, AUTHOR),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects an oversized object and returns its path for deletion after the transaction', async () => {
    const { tx, bucket } = setup();
    bucket.files.set(path, stored({ size: 25 * MB + 1 }));
    const out = await finalizeUpdateAttachmentInTransaction(tx, bucket, req, AUTHOR);
    expect(out).toMatchObject({ kind: 'rejected', storagePathToDelete: path });
    expect(bucket.deleted).toEqual([]);
    expect(tx.writes).toHaveLength(0);
  });

  it('rejects when the post already has 10 attachments', async () => {
    const { tx, bucket } = setup();
    bucket.files.set(path, stored());
    tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments = Array.from({ length: 10 }, (_, i) =>
      attachment(`f${i}`),
    );
    const out = await finalizeUpdateAttachmentInTransaction(tx, bucket, req, AUTHOR);
    expect(out).toMatchObject({ kind: 'rejected', storagePathToDelete: path });
    expect(tx.writes).toHaveLength(0);
  });
});

describe('getUpdateAttachmentUrl', () => {
  it('gives every board reader, viewers included, a 5 minute URL with the stored name', async () => {
    const { tx, bucket } = setup();
    tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments = [
      { ...attachment('f1'), name: 'Quarterly plan.pdf' },
    ];
    for (const uid of [AUTHOR, OTHER_EDITOR, BOARD_OWNER, VIEWER]) {
      const res = await getUpdateAttachmentUrlInTransaction(
        tx,
        bucket,
        { ...target, fileId: 'f1' },
        uid,
      );
      expect(res.downloadUrl).toContain('boards/b_1/items/i_1/updates/u_1/f1');
    }
    expect(bucket.signedDownloads.every((d) => d.expires === 300)).toBe(true);
    expect(bucket.signedDownloads[0]!.disposition).toBe(
      `attachment; filename="Quarterly plan.pdf"; filename*=UTF-8''Quarterly%20plan.pdf`,
    );
  });

  it('works for a reply, and for an archived item', async () => {
    const { tx, bucket } = setup({ itemState: 'archived' });
    const p = 'boards/b_1/items/i_1/updates/u_1/replies/r_1/f1';
    tx.posts.get(postKey('b_1', 'i_1', 'u_1', 'r_1'))!.attachments = [attachment('f1', p)];
    const res = await getUpdateAttachmentUrlInTransaction(
      tx,
      bucket,
      { ...replyTarget, fileId: 'f1' },
      VIEWER,
    );
    expect(res.downloadUrl).toContain(p);
  });

  it('refuses unlisted files, outsiders, deleted items and forged stored paths', async () => {
    const { tx, bucket } = setup();
    tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments = [
      attachment('f1'),
      attachment('forged', 'boards/other/items/x/updates/u/forged'),
    ];
    await expect(
      getUpdateAttachmentUrlInTransaction(tx, bucket, { ...target, fileId: 'nope' }, VIEWER),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      getUpdateAttachmentUrlInTransaction(tx, bucket, { ...target, fileId: 'f1' }, 'stranger'),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      getUpdateAttachmentUrlInTransaction(tx, bucket, { ...target, fileId: 'forged' }, VIEWER),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(bucket.signedDownloads).toHaveLength(0);

    const gone = setup({ itemState: 'deleted' });
    gone.tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments = [attachment('f1')];
    await expect(
      getUpdateAttachmentUrlInTransaction(
        gone.tx,
        gone.bucket,
        { ...target, fileId: 'f1' },
        VIEWER,
      ),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('deleteUpdateAttachment', () => {
  it('lets the author remove their file and returns the path to delete after the commit', async () => {
    const { tx } = setup();
    tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments = [attachment('f1'), attachment('f2')];
    const out = await deleteUpdateAttachmentInTransaction(tx, { ...target, fileId: 'f1' }, AUTHOR);
    expect(out.storagePathToDelete).toBe('boards/b_1/items/i_1/updates/u_1/f1');
    expect(out.result.attachments.map((a) => a.id)).toEqual(['f2']);
    expect(tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments).toHaveLength(1);
  });

  it("lets a board owner remove someone else's file, including a reply's", async () => {
    const { tx } = setup();
    const p = 'boards/b_1/items/i_1/updates/u_1/replies/r_1/f1';
    tx.posts.get(postKey('b_1', 'i_1', 'u_1', 'r_1'))!.attachments = [attachment('f1', p)];
    const out = await deleteUpdateAttachmentInTransaction(
      tx,
      { ...replyTarget, fileId: 'f1' },
      BOARD_OWNER,
    );
    expect(out.storagePathToDelete).toBe(p);
    expect(out.result.attachments).toEqual([]);
  });

  it('refuses another editor and a viewer, and an unknown file', async () => {
    const { tx } = setup();
    tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments = [attachment('f1')];
    for (const uid of [OTHER_EDITOR, VIEWER]) {
      await expect(
        deleteUpdateAttachmentInTransaction(tx, { ...target, fileId: 'f1' }, uid),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    }
    await expect(
      deleteUpdateAttachmentInTransaction(tx, { ...target, fileId: 'nope' }, AUTHOR),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(tx.writes).toHaveLength(0);
  });

  it('refuses a forged stored path and leaves the post untouched', async () => {
    const { tx } = setup();
    tx.posts.get(postKey('b_1', 'i_1', 'u_1'))!.attachments = [
      attachment('f1', 'boards/other/items/x/updates/u/f1'),
    ];
    await expect(
      deleteUpdateAttachmentInTransaction(tx, { ...target, fileId: 'f1' }, AUTHOR),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(tx.writes).toHaveLength(0);
  });
});

describe('contentDispositionFor', () => {
  it('keeps an ASCII fallback and the UTF-8 name, and cannot break out of the quotes', () => {
    expect(contentDispositionFor('a"b.pdf')).toContain('filename="a_b.pdf"');
    const d = contentDispositionFor('Résumé (1).pdf');
    expect(d).toContain('filename="R_sum_ (1).pdf"');
    expect(d).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%281%29.pdf");
  });
});

describe('orphan sweeper for update attachments', () => {
  const posts: Record<string, UpdatePostDoc> = {
    u_1: { authorId: AUTHOR, attachments: [attachment('kept_update')] },
    'u_1/r_1': { authorId: AUTHOR, attachments: [attachment('kept_reply')] },
    'u_dead_parent/r_9': { authorId: AUTHOR, attachments: [attachment('kept_reply')] },
  };
  const getPost = async (u: string, r?: string) => posts[r ? `${u}/${r}` : u] ?? null;

  it('treats an object as referenced only when the post lists its fileId', async () => {
    const base = 'boards/b_1/items/i_1/updates';
    expect(await isUpdateAttachmentReferenced(`${base}/u_1/kept_update`, getPost)).toBe(true);
    expect(await isUpdateAttachmentReferenced(`${base}/u_1/other`, getPost)).toBe(false);
    expect(await isUpdateAttachmentReferenced(`${base}/u_gone/kept_update`, getPost)).toBe(false);
    expect(await isUpdateAttachmentReferenced(`${base}/u_1/replies/r_1/kept_reply`, getPost)).toBe(
      true,
    );
    expect(await isUpdateAttachmentReferenced(`${base}/u_1/replies/r_1/other`, getPost)).toBe(
      false,
    );
    expect(
      await isUpdateAttachmentReferenced(`${base}/u_1/replies/r_gone/kept_reply`, getPost),
    ).toBe(false);
    // The reply document survives its deleted parent update (client deletes don't cascade).
    expect(
      await isUpdateAttachmentReferenced(`${base}/u_dead_parent/replies/r_9/kept_reply`, getPost),
    ).toBe(false);
    expect(await isUpdateAttachmentReferenced('boards/b/items/i/files/f', getPost)).toBeNull();
  });

  it('sweeps unreferenced update and reply objects older than an hour and keeps the rest', async () => {
    const cutoff = 1_700_000_000_000;
    const old = new Date(cutoff - 1000).toISOString();
    const recent = new Date(cutoff + 1000).toISOString();
    const b = 'boards/b_1/items/i_1/updates';
    const deleted: string[] = [];
    const store: OrphanSweeperStore = {
      listUploadFiles: async () => [
        { name: `${b}/u_1/orphan_old`, timeCreated: old },
        { name: `${b}/u_1/kept_update`, timeCreated: old },
        { name: `${b}/u_1/orphan_recent`, timeCreated: recent },
        { name: `${b}/u_1/replies/r_1/orphan_old`, timeCreated: old },
        { name: `${b}/u_1/replies/r_1/kept_reply`, timeCreated: old },
        { name: `${b}/u_1/replies/r_1/orphan_recent`, timeCreated: recent },
      ],
      isStoragePathReferenced: async (_b, _i, path) =>
        (await isUpdateAttachmentReferenced(path, getPost)) ?? false,
      deleteFile: async (path) => void deleted.push(path),
    };
    const res = await sweepOrphanUploads(store, cutoff);
    expect(res).toEqual({ scanned: 6, deleted: 2 });
    expect(deleted).toEqual([`${b}/u_1/orphan_old`, `${b}/u_1/replies/r_1/orphan_old`]);
  });
});
