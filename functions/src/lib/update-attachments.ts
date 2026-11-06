import {
  UPDATE_ATTACHMENT_MAX_BYTES,
  UPDATE_ATTACHMENT_MAX_PER_POST,
  canManageBoard,
  filesSettingsSchema,
  isFileAllowed,
  resolveBoardRole,
  updateAttachmentsSchema,
  type DeleteUpdateAttachmentRequest,
  type DeleteUpdateAttachmentResult,
  type FileAttachment,
  type FinalizeUpdateAttachmentRequest,
  type FinalizeUpdateAttachmentResult,
  type GetUpdateAttachmentUrlRequest,
  type GetUpdateAttachmentUrlResult,
  type RequestUpdateAttachmentUploadRequest,
  type RequestUpdateAttachmentUploadResult,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { verifyBoardAccess, type FileStorageBucket, type FileStorageTx } from './file-storage';

/** The part of an update or reply document these callables read. */
export interface UpdatePostDoc {
  authorId: string;
  /** Raw stored value; parsed with `updateAttachmentsSchema` before use. */
  attachments?: unknown;
}

/** What the update-attachment callables need on top of the files-column transaction. */
export interface UpdateAttachmentTx extends FileStorageTx {
  /** The update, or the reply when `replyId` is set; `null` when it does not exist. */
  getPost(
    boardId: string,
    itemId: string,
    updateId: string,
    replyId?: string,
  ): Promise<UpdatePostDoc | null>;
  /** Replaces `attachments` on the update or reply (the only write path; rules refuse clients). */
  setAttachments(
    boardId: string,
    itemId: string,
    updateId: string,
    replyId: string | undefined,
    attachments: FileAttachment[],
  ): void;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_MB = UPDATE_ATTACHMENT_MAX_BYTES / (1024 * 1024);

interface PostTarget {
  boardId: string;
  itemId: string;
  updateId: string;
  replyId?: string | undefined;
}

/**
 * The only Storage path an update attachment may live at; every segment must be a safe id.
 * `boards/{b}/items/{i}/updates/{u}/{fileId}`, or for a reply
 * `boards/{b}/items/{i}/updates/{u}/replies/{r}/{fileId}`.
 */
export function updateAttachmentPath(target: PostTarget, fileId: string): string {
  const segments = [target.boardId, target.itemId, target.updateId, fileId];
  if (target.replyId !== undefined) segments.push(target.replyId);
  for (const segment of segments) {
    if (!SAFE_ID.test(segment)) throw new HttpsError('invalid-argument', 'Invalid attachment path');
  }
  const base = `boards/${target.boardId}/items/${target.itemId}/updates/${target.updateId}`;
  return target.replyId !== undefined
    ? `${base}/replies/${target.replyId}/${fileId}`
    : `${base}/${fileId}`;
}

/** The attachments already on the post. A corrupt value is refused rather than guessed at. */
function currentAttachments(post: UpdatePostDoc): FileAttachment[] {
  const parsed = updateAttachmentsSchema.safeParse(post.attachments ?? []);
  if (!parsed.success) {
    throw new HttpsError('failed-precondition', 'Stored attachments are corrupt');
  }
  return parsed.data;
}

async function loadPost(tx: UpdateAttachmentTx, target: PostTarget): Promise<UpdatePostDoc> {
  const post = await tx.getPost(target.boardId, target.itemId, target.updateId, target.replyId);
  if (!post) {
    throw new HttpsError('not-found', target.replyId ? 'Reply not found' : 'Update not found');
  }
  return post;
}

/**
 * The post on a live item (never a deleted one); for a reply its parent update must exist too.
 * `allowArchived` lets reads and removals work on archived items; uploads need an active one.
 */
async function loadLivePost(
  tx: UpdateAttachmentTx,
  target: PostTarget,
  allowArchived: boolean,
): Promise<UpdatePostDoc> {
  const item = await tx.getItem(target.boardId, target.itemId);
  if (!item || item.state === 'deleted') throw new HttpsError('not-found', 'Item not found');
  if (!allowArchived && item.state !== 'active') {
    throw new HttpsError(
      'failed-precondition',
      'Cannot attach files to an update on an archived or deleted item',
    );
  }
  if (target.replyId !== undefined) {
    await loadPost(tx, { ...target, replyId: undefined });
  }
  return loadPost(tx, target);
}

function assertAuthor(post: UpdatePostDoc, authUid: string): void {
  if (post.authorId !== authUid) {
    throw new HttpsError('permission-denied', 'Only the author can attach files to this post');
  }
}

/** Author only, with edit access; the item must be active; 25 MB; allowed type; fewer than 10 files. */
export async function requestUpdateAttachmentUploadInTransaction(
  tx: UpdateAttachmentTx,
  storageBucket: FileStorageBucket,
  request: RequestUpdateAttachmentUploadRequest,
  authUid: string,
): Promise<RequestUpdateAttachmentUploadResult> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, true);

  const post = await loadLivePost(tx, request, false);
  assertAuthor(post, authUid);

  if (request.size > UPDATE_ATTACHMENT_MAX_BYTES) {
    throw new HttpsError('invalid-argument', `Attachments can be at most ${MAX_MB} MB`);
  }
  const settings = filesSettingsSchema.parse({ maxFileSizeMb: MAX_MB });
  if (
    !isFileAllowed(
      { name: request.fileName, size: request.size, mimeType: request.contentType },
      settings,
    )
  ) {
    throw new HttpsError('invalid-argument', 'This file type is not allowed');
  }
  if (currentAttachments(post).length >= UPDATE_ATTACHMENT_MAX_PER_POST) {
    throw new HttpsError(
      'failed-precondition',
      `A post can have at most ${UPDATE_ATTACHMENT_MAX_PER_POST} attachments`,
    );
  }

  const fileId = tx.generateFileId ? tx.generateFileId() : crypto.randomUUID().replace(/-/g, '');
  const { uploadUrl, expiresAt, headers } = await storageBucket.getSignedUploadUrl(
    updateAttachmentPath(request, fileId),
    request.contentType,
    request.size,
    10 * 60,
  );
  return {
    uploadUrl,
    fileId,
    expiresAt,
    headers: headers ?? {
      'content-type': request.contentType,
      'x-goog-content-length-range': `0,${request.size}`,
    },
  };
}

export type FinalizeUpdateAttachmentOutcome =
  | { kind: 'success'; result: FinalizeUpdateAttachmentResult }
  | { kind: 'rejected'; error: HttpsError; storagePathToDelete: string };

/**
 * Checks the uploaded object (size, type and created time from Storage's own metadata) and appends
 * it to the post. A repeat call for a listed fileId changes nothing and returns the stored entry. A
 * rejected object is returned for the caller to delete AFTER the transaction.
 */
export async function finalizeUpdateAttachmentInTransaction(
  tx: UpdateAttachmentTx,
  storageBucket: FileStorageBucket,
  request: FinalizeUpdateAttachmentRequest,
  authUid: string,
  nowIso?: string,
): Promise<FinalizeUpdateAttachmentOutcome> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, true);

  const post = await loadLivePost(tx, request, false);
  assertAuthor(post, authUid);

  const existing = currentAttachments(post);
  const already = existing.find((a) => a.id === request.fileId);
  if (already) return { kind: 'success', result: { attachment: already } };

  const storagePath = updateAttachmentPath(request, request.fileId);
  const metadata = await storageBucket.getFileMetadata(storagePath);
  if (!metadata) throw new HttpsError('not-found', 'The file was not uploaded');

  const settings = filesSettingsSchema.parse({ maxFileSizeMb: MAX_MB });
  if (
    metadata.size > UPDATE_ATTACHMENT_MAX_BYTES ||
    !isFileAllowed(
      { name: request.fileName, size: metadata.size, mimeType: metadata.contentType },
      settings,
    )
  ) {
    return {
      kind: 'rejected',
      error: new HttpsError(
        'invalid-argument',
        `The uploaded file is too large (${MAX_MB} MB at most) or of a type that is not allowed`,
      ),
      storagePathToDelete: storagePath,
    };
  }
  if (existing.length >= UPDATE_ATTACHMENT_MAX_PER_POST) {
    return {
      kind: 'rejected',
      error: new HttpsError(
        'failed-precondition',
        `A post can have at most ${UPDATE_ATTACHMENT_MAX_PER_POST} attachments`,
      ),
      storagePathToDelete: storagePath,
    };
  }

  const attachment: FileAttachment = {
    id: request.fileId,
    name: request.fileName.slice(0, 255),
    storagePath,
    size: metadata.size,
    mimeType: metadata.contentType,
    uploadedAt: metadata.timeCreated || (nowIso ?? new Date().toISOString()),
    uploadedBy: authUid,
  };
  tx.setAttachments(request.boardId, request.itemId, request.updateId, request.replyId, [
    ...existing,
    attachment,
  ]);
  return { kind: 'success', result: { attachment } };
}

/** `attachment` disposition with an ASCII fallback and the RFC 5987 UTF-8 name. */
export function contentDispositionFor(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Any board reader gets a 5 minute signed GET URL for a file the post lists. */
export async function getUpdateAttachmentUrlInTransaction(
  tx: UpdateAttachmentTx,
  storageBucket: FileStorageBucket,
  request: GetUpdateAttachmentUrlRequest,
  authUid: string,
): Promise<GetUpdateAttachmentUrlResult> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, false);

  const post = await loadLivePost(tx, request, true);
  const file = currentAttachments(post).find((a) => a.id === request.fileId);
  if (!file) throw new HttpsError('not-found', 'Attachment not found on this post');

  const storagePath = updateAttachmentPath(request, file.id);
  if (file.storagePath !== storagePath) {
    throw new HttpsError(
      'failed-precondition',
      'Stored file path does not match this post; refusing to access it',
    );
  }
  const { downloadUrl, expiresAt } = await storageBucket.getSignedDownloadUrl(storagePath, 5 * 60, {
    contentDisposition: contentDispositionFor(file.name),
  });
  return { downloadUrl, expiresAt };
}

export interface DeleteUpdateAttachmentOutcome {
  result: DeleteUpdateAttachmentResult;
  storagePathToDelete: string;
}

/**
 * The post's author, or a board owner, removes a file. The Storage object is deleted by the caller
 * strictly AFTER the transaction commits.
 */
export async function deleteUpdateAttachmentInTransaction(
  tx: UpdateAttachmentTx,
  request: DeleteUpdateAttachmentRequest,
  authUid: string,
): Promise<DeleteUpdateAttachmentOutcome> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, true);

  const post = await loadLivePost(tx, request, true);
  const role = resolveBoardRole(board!, authUid, workspace?.roles?.[authUid] ?? null);
  if (post.authorId !== authUid && !canManageBoard(role)) {
    throw new HttpsError(
      'permission-denied',
      'Only the author or a board owner can remove this attachment',
    );
  }

  const existing = currentAttachments(post);
  const target = existing.find((a) => a.id === request.fileId);
  if (!target) throw new HttpsError('not-found', 'Attachment not found on this post');

  const storagePathToDelete = updateAttachmentPath(request, target.id);
  if (target.storagePath !== storagePathToDelete) {
    throw new HttpsError(
      'failed-precondition',
      'Stored file path does not match this post; refusing to delete it',
    );
  }
  const remaining = existing.filter((a) => a.id !== request.fileId);
  tx.setAttachments(request.boardId, request.itemId, request.updateId, request.replyId, remaining);
  return { result: { success: true, attachments: remaining }, storagePathToDelete };
}

/**
 * For the orphan sweeper: whether the post document lists the object at `storagePath`.
 * `null` when the path is not an update or reply attachment path. A reply whose parent update is
 * gone (client deletes don't cascade) is unreferenced, so its files are swept too.
 */
export async function isUpdateAttachmentReferenced(
  storagePath: string,
  getPost: (updateId: string, replyId?: string) => Promise<UpdatePostDoc | null>,
): Promise<boolean | null> {
  const match =
    /^boards\/[^/]+\/items\/[^/]+\/updates\/([^/]+)(?:\/replies\/([^/]+))?\/([^/]+)$/.exec(
      storagePath,
    );
  if (!match) return null;
  const [, updateId, replyId, fileId] = match;
  if (!(await getPost(updateId!))) return false;
  const post = replyId ? await getPost(updateId!, replyId) : await getPost(updateId!);
  if (!post || !Array.isArray(post.attachments)) return false;
  return (post.attachments as Array<{ id?: unknown }>).some((a) => a && a.id === fileId);
}
