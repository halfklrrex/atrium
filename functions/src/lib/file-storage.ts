import {
  type Board,
  type DeleteFileAttachmentRequest,
  type DeleteFileAttachmentResult,
  type FileAttachment,
  type FilesValue,
  type FinalizeFileUploadRequest,
  type GetFileDownloadUrlRequest,
  type GetFileDownloadUrlResult,
  type Item,
  type RequestFileUploadRequest,
  type RequestFileUploadResult,
  type Workspace,
  COLUMN_LOCKED_MESSAGE,
  canEditBoard,
  canEditColumn,
  filesSettingsSchema,
  filesValueSchema,
  isFileAllowed,
  resolveBoardRole,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';

export interface StorageFileMetadata {
  size: number;
  contentType: string;
  timeCreated: string;
}

export interface FileStorageBucket {
  getFileMetadata(storagePath: string): Promise<StorageFileMetadata | null>;
  deleteFile(storagePath: string): Promise<void>;
  getSignedUploadUrl(
    storagePath: string,
    contentType: string,
    size: number,
    expiresInSeconds: number,
  ): Promise<{ uploadUrl: string; expiresAt: number; headers?: Record<string, string> }>;
  getSignedDownloadUrl(
    storagePath: string,
    expiresInSeconds: number,
  ): Promise<{ downloadUrl: string; expiresAt: number }>;
  listUploadFiles?(prefix?: string): Promise<OrphanFileCandidate[]>;
}

export interface FileStorageTx {
  getBoard(boardId: string): Promise<Board | null>;
  getWorkspace(workspaceId: string): Promise<Workspace | null>;
  getItem(boardId: string, itemId: string): Promise<Item | null>;
  updateItemValues(boardId: string, itemId: string, values: Record<string, unknown>): void;
  generateFileId?(): string;
}

export type FinalizeOutcome =
  | { kind: 'success'; file: FileAttachment; columnValue: FilesValue }
  | { kind: 'rejected'; error: HttpsError; storagePathToDelete: string };

export interface DeleteAttachmentOutcome {
  result: DeleteFileAttachmentResult;
  storagePathToDelete: string;
}

export interface OrphanFileCandidate {
  name: string;
  timeCreated: string;
}

export interface OrphanSweeperStore {
  listUploadFiles(): Promise<OrphanFileCandidate[]>;
  isStoragePathReferenced(boardId: string, itemId: string, storagePath: string): Promise<boolean>;
  deleteFile(storagePath: string): Promise<void>;
}

/**
 * Sweeps orphan storage objects older than cutoffMs (e.g. 1 hour old)
 * that have no corresponding reference in their item: a files cell for `.../files/{id}`, the
 * `descriptionImages` map for `.../description/{id}`.
 */
export async function sweepOrphanUploads(
  store: OrphanSweeperStore,
  cutoffMs: number,
): Promise<{ scanned: number; deleted: number }> {
  const files = await store.listUploadFiles();
  let deleted = 0;
  for (const f of files) {
    const match = /^boards\/([^/]+)\/items\/([^/]+)\/(?:files|description)\/([^/]+)$/.exec(f.name);
    if (!match) continue;
    const [, boardId, itemId] = match;
    const createdMs = new Date(f.timeCreated).getTime();
    if (createdMs > cutoffMs) {
      continue;
    }
    const referenced = await store.isStoragePathReferenced(boardId!, itemId!, f.name);
    if (!referenced) {
      await store.deleteFile(f.name);
      deleted++;
    }
  }
  return { scanned: files.length, deleted };
}

/**
 * The only Storage path a file attachment may live at. Clients can never write a files cell
 * (server-managed), but a stored `storagePath` is still re-derived and checked before it is signed
 * or deleted, so a forged cell can't reach another board's object.
 */
function canonicalStoragePath(boardId: string, itemId: string, fileId: string): string {
  return `boards/${boardId}/items/${itemId}/files/${fileId}`;
}

function assertStoredPathIsCanonical(file: FileAttachment, expectedPath: string): void {
  if (file.storagePath !== expectedPath) {
    throw new HttpsError(
      'failed-precondition',
      'Stored file path does not match this item; refusing to access it',
    );
  }
}

/**
 * Validates board edit or view permission for the current user against workspace membership
 * and explicit board access roles. Mirrors firestore.rules boardRole().
 */
export function verifyBoardAccess(
  board: Board | null,
  workspace: Workspace | null,
  authUid: string,
  requireEdit: boolean,
  columnId?: string,
): void {
  if (!board) {
    throw new HttpsError('not-found', 'Board not found');
  }

  // Workspace membership is required; removed members lose all board access
  const wsRole = workspace?.roles?.[authUid] ?? null;
  const role = resolveBoardRole(board, authUid, wsRole);

  if (!role) {
    throw new HttpsError('permission-denied', 'You do not have access to this board');
  }

  if (requireEdit && !canEditBoard(role)) {
    throw new HttpsError('permission-denied', 'You do not have permission to edit this board');
  }

  if (requireEdit && columnId && !canEditColumn(role, board, columnId)) {
    throw new HttpsError('permission-denied', COLUMN_LOCKED_MESSAGE);
  }
}

/**
 * Validates file upload constraints and returns a short-lived V4 signed PUT URL with size-range extension header.
 */
export async function requestFileUploadInTransaction(
  tx: FileStorageTx,
  storageBucket: FileStorageBucket,
  request: RequestFileUploadRequest,
  authUid: string,
): Promise<RequestFileUploadResult> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, true, request.columnId);

  const colDef = board!.columns.find((c) => c.id === request.columnId);
  if (!colDef) {
    throw new HttpsError('not-found', `Column "${request.columnId}" not found on board`);
  }
  if (colDef.type !== 'files') {
    throw new HttpsError('invalid-argument', `Column "${request.columnId}" is not a files column`);
  }

  const parsedSettings = filesSettingsSchema.safeParse(colDef.settings ?? {});
  if (!parsedSettings.success) {
    throw new HttpsError('failed-precondition', 'Invalid files column settings');
  }
  const settings = parsedSettings.data;

  const item = await tx.getItem(request.boardId, request.itemId);
  if (!item) {
    throw new HttpsError('not-found', 'Item not found');
  }
  if (item.state !== 'active') {
    throw new HttpsError(
      'failed-precondition',
      'Cannot attach files to an archived or deleted item',
    );
  }

  const maxGlobalBytes = 100 * 1024 * 1024;
  if (request.size > maxGlobalBytes) {
    throw new HttpsError(
      'invalid-argument',
      `File size (${request.size} bytes) exceeds global maximum of 100 MB`,
    );
  }

  const maxColBytes = settings.maxFileSizeMb * 1024 * 1024;
  if (request.size > maxColBytes) {
    throw new HttpsError(
      'invalid-argument',
      `File size (${request.size} bytes) exceeds column maximum of ${settings.maxFileSizeMb} MB`,
    );
  }

  if (
    !isFileAllowed(
      { name: request.fileName, size: request.size, mimeType: request.contentType },
      settings,
    )
  ) {
    throw new HttpsError(
      'invalid-argument',
      `File type "${request.contentType}" or extension is not allowed by column settings`,
    );
  }

  const currentRaw = item.values?.[request.columnId];
  const parsedValue = currentRaw
    ? filesValueSchema.safeParse(currentRaw)
    : { success: true as const, data: { files: [] } };
  if (!parsedValue.success) {
    throw new HttpsError('failed-precondition', 'Stored files cell value is corrupt');
  }
  if (parsedValue.data.files.length >= 100) {
    throw new HttpsError('failed-precondition', 'Maximum files limit (100) reached');
  }

  const fileId = tx.generateFileId ? tx.generateFileId() : crypto.randomUUID().replace(/-/g, '');
  const storagePath = canonicalStoragePath(request.boardId, request.itemId, fileId);

  // 10 minutes upload URL validity with strict size enforcement header
  const { uploadUrl, expiresAt, headers } = await storageBucket.getSignedUploadUrl(
    storagePath,
    request.contentType,
    request.size,
    10 * 60,
  );

  return {
    uploadUrl,
    fileId,
    storagePath,
    expiresAt,
    headers: headers ?? {
      'content-type': request.contentType,
      'x-goog-content-length-range': `0,${request.size}`,
    },
  };
}

/**
 * Verifies an uploaded file's metadata in Cloud Storage, validates it against column settings,
 * and atomically appends the file attachment to the Firestore item's files cell.
 * Does NOT delete from storage inside the transaction callback; returns a rejected outcome
 * with storagePathToDelete so the caller deletes only after the transaction resolves.
 */
export async function finalizeFileUploadInTransaction(
  tx: FileStorageTx,
  storageBucket: FileStorageBucket,
  request: FinalizeFileUploadRequest,
  authUid: string,
  nowIso?: string,
): Promise<FinalizeOutcome> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, true, request.columnId);

  const colDef = board!.columns.find((c) => c.id === request.columnId);
  if (!colDef) {
    throw new HttpsError('not-found', `Column "${request.columnId}" not found on board`);
  }
  if (colDef.type !== 'files') {
    throw new HttpsError('invalid-argument', `Column "${request.columnId}" is not a files column`);
  }

  const parsedSettings = filesSettingsSchema.safeParse(colDef.settings ?? {});
  if (!parsedSettings.success) {
    throw new HttpsError('failed-precondition', 'Invalid files column settings');
  }
  const settings = parsedSettings.data;

  const item = await tx.getItem(request.boardId, request.itemId);
  if (!item) {
    throw new HttpsError('not-found', 'Item not found');
  }
  if (item.state !== 'active') {
    throw new HttpsError(
      'failed-precondition',
      'Cannot attach files to an archived or deleted item',
    );
  }

  const storagePath = canonicalStoragePath(request.boardId, request.itemId, request.fileId);
  const metadata = await storageBucket.getFileMetadata(storagePath);
  if (!metadata) {
    throw new HttpsError('not-found', `File does not exist in storage at "${storagePath}"`);
  }

  const maxColBytes = settings.maxFileSizeMb * 1024 * 1024;
  if (
    metadata.size > 100 * 1024 * 1024 ||
    metadata.size > maxColBytes ||
    !isFileAllowed(
      { name: request.fileName, size: metadata.size, mimeType: metadata.contentType },
      settings,
    )
  ) {
    return {
      kind: 'rejected',
      error: new HttpsError(
        'invalid-argument',
        `Uploaded file fails size (${metadata.size} bytes) or MIME type (${metadata.contentType}) validation`,
      ),
      storagePathToDelete: storagePath,
    };
  }

  const currentRaw = item.values?.[request.columnId];
  const parsedValue = currentRaw
    ? filesValueSchema.safeParse(currentRaw)
    : { success: true as const, data: { files: [] } };
  if (!parsedValue.success) {
    throw new HttpsError('failed-precondition', 'Stored files cell value is corrupt');
  }

  if (parsedValue.data.files.length >= 100) {
    return {
      kind: 'rejected',
      error: new HttpsError('failed-precondition', 'Maximum files limit (100) reached'),
      storagePathToDelete: storagePath,
    };
  }
  if (parsedValue.data.files.some((f) => f.id === request.fileId)) {
    throw new HttpsError(
      'already-exists',
      `File with id "${request.fileId}" is already attached to this cell`,
    );
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

  const updatedValue: FilesValue = {
    files: [...parsedValue.data.files, attachment],
  };

  tx.updateItemValues(request.boardId, request.itemId, {
    [request.columnId]: updatedValue,
  });

  return {
    kind: 'success',
    file: attachment,
    columnValue: updatedValue,
  };
}

/**
 * Checks board read permission and returns a short-lived V4 signed GET URL for downloading.
 * Refuses deleted items.
 */
export async function getFileDownloadUrlInTransaction(
  tx: FileStorageTx,
  storageBucket: FileStorageBucket,
  request: GetFileDownloadUrlRequest,
  authUid: string,
): Promise<GetFileDownloadUrlResult> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, false);

  const item = await tx.getItem(request.boardId, request.itemId);
  if (!item || item.state === 'deleted') {
    throw new HttpsError('not-found', 'Item not found');
  }

  const currentRaw = item.values?.[request.columnId];
  const parsedValue = currentRaw
    ? filesValueSchema.safeParse(currentRaw)
    : { success: true as const, data: { files: [] } };
  if (!parsedValue.success) {
    throw new HttpsError('failed-precondition', 'Stored files cell value is corrupt');
  }

  const file = parsedValue.data.files.find((f) => f.id === request.fileId);
  if (!file) {
    throw new HttpsError('not-found', `File with id "${request.fileId}" not found in this cell`);
  }

  const storagePath = canonicalStoragePath(request.boardId, request.itemId, file.id);
  assertStoredPathIsCanonical(file, storagePath);

  // 5 minutes download URL validity
  const { downloadUrl, expiresAt } = await storageBucket.getSignedDownloadUrl(storagePath, 5 * 60);

  return {
    downloadUrl,
    expiresAt,
  };
}

/**
 * Removes a file attachment from an item cell in Firestore and returns the storage path to delete.
 * The storage object is deleted strictly AFTER the transaction commits.
 */
export async function deleteFileAttachmentInTransaction(
  tx: FileStorageTx,
  request: DeleteFileAttachmentRequest,
  authUid: string,
): Promise<DeleteAttachmentOutcome> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, true, request.columnId);

  const colDef = board!.columns.find((c) => c.id === request.columnId);
  if (!colDef) {
    throw new HttpsError('not-found', `Column "${request.columnId}" not found on board`);
  }
  if (colDef.type !== 'files') {
    throw new HttpsError('invalid-argument', `Column "${request.columnId}" is not a files column`);
  }

  const item = await tx.getItem(request.boardId, request.itemId);
  if (!item) {
    throw new HttpsError('not-found', 'Item not found');
  }

  const currentRaw = item.values?.[request.columnId];
  const parsedValue = currentRaw
    ? filesValueSchema.safeParse(currentRaw)
    : { success: true as const, data: { files: [] } };
  if (!parsedValue.success) {
    throw new HttpsError('failed-precondition', 'Stored files cell value is corrupt');
  }

  const targetFile = parsedValue.data.files.find((f) => f.id === request.fileId);
  if (!targetFile) {
    throw new HttpsError('not-found', `File with id "${request.fileId}" not found in this cell`);
  }

  const storagePathToDelete = canonicalStoragePath(request.boardId, request.itemId, targetFile.id);
  assertStoredPathIsCanonical(targetFile, storagePathToDelete);

  const updatedValue: FilesValue = {
    files: parsedValue.data.files.filter((f) => f.id !== request.fileId),
  };

  // Commit Firestore
  tx.updateItemValues(request.boardId, request.itemId, {
    [request.columnId]: updatedValue,
  });

  return {
    result: {
      success: true,
      columnValue: updatedValue,
    },
    storagePathToDelete,
  };
}
