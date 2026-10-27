import {
  DESCRIPTION_IMAGE_MAX_BYTES,
  DESCRIPTION_IMAGE_MAX_PER_ITEM,
  descriptionImagesSchema,
  isDescriptionImageType,
  type DescriptionImage,
  type FinalizeDescriptionImageRequest,
  type FinalizeDescriptionImageResult,
  type GetDescriptionImageUrlRequest,
  type GetDescriptionImageUrlResult,
  type RequestDescriptionImageUploadRequest,
  type RequestDescriptionImageUploadResult,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import { verifyBoardAccess, type FileStorageBucket, type FileStorageTx } from './file-storage';

/** What the description-image callables need on top of the files-column transaction. */
export interface DescriptionImageTx extends FileStorageTx {
  /** Writes `items/{itemId}.descriptionImages.<fileId>` as a field path (never the whole map). */
  setDescriptionImage(
    boardId: string,
    itemId: string,
    fileId: string,
    image: DescriptionImage,
  ): void;
}

/** The only Storage path a description image may live at. */
export function descriptionImagePath(boardId: string, itemId: string, fileId: string): string {
  return `boards/${boardId}/items/${itemId}/description/${fileId}`;
}

/** The images already on the item. A corrupt map is refused rather than guessed at. */
function currentImages(raw: unknown) {
  const parsed = descriptionImagesSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new HttpsError('failed-precondition', 'Stored description images are corrupt');
  }
  return parsed.data;
}

/** Editors only; the item must be active; PNG, JPEG, GIF or WebP up to 10 MB; at most 50 per item. */
export async function requestDescriptionImageUploadInTransaction(
  tx: DescriptionImageTx,
  storageBucket: FileStorageBucket,
  request: RequestDescriptionImageUploadRequest,
  authUid: string,
): Promise<RequestDescriptionImageUploadResult> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, true);

  const item = await tx.getItem(request.boardId, request.itemId);
  if (!item) throw new HttpsError('not-found', 'Item not found');
  if (item.state !== 'active') {
    throw new HttpsError('failed-precondition', 'Cannot add images to an archived or deleted item');
  }

  if (!isDescriptionImageType(request.contentType)) {
    throw new HttpsError('invalid-argument', 'Only PNG, JPEG, GIF and WebP images can be added');
  }
  if (request.size > DESCRIPTION_IMAGE_MAX_BYTES) {
    throw new HttpsError('invalid-argument', 'Images can be at most 10 MB');
  }
  if (Object.keys(currentImages(item.descriptionImages)).length >= DESCRIPTION_IMAGE_MAX_PER_ITEM) {
    throw new HttpsError(
      'failed-precondition',
      `An item can have at most ${DESCRIPTION_IMAGE_MAX_PER_ITEM} description images`,
    );
  }

  const fileId = tx.generateFileId ? tx.generateFileId() : crypto.randomUUID().replace(/-/g, '');
  const { uploadUrl, expiresAt, headers } = await storageBucket.getSignedUploadUrl(
    descriptionImagePath(request.boardId, request.itemId, fileId),
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

export type FinalizeDescriptionImageOutcome =
  | { kind: 'success'; result: FinalizeDescriptionImageResult }
  | { kind: 'rejected'; error: HttpsError; storagePathToDelete: string };

/**
 * Checks the uploaded object (size and image type from Storage's own metadata) and records it on
 * the item. A rejected object is returned for the caller to delete AFTER the transaction.
 */
export async function finalizeDescriptionImageInTransaction(
  tx: DescriptionImageTx,
  storageBucket: FileStorageBucket,
  request: FinalizeDescriptionImageRequest,
  authUid: string,
  nowIso?: string,
): Promise<FinalizeDescriptionImageOutcome> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, true);

  const item = await tx.getItem(request.boardId, request.itemId);
  if (!item) throw new HttpsError('not-found', 'Item not found');
  if (item.state !== 'active') {
    throw new HttpsError('failed-precondition', 'Cannot add images to an archived or deleted item');
  }

  const storagePath = descriptionImagePath(request.boardId, request.itemId, request.fileId);
  const metadata = await storageBucket.getFileMetadata(storagePath);
  if (!metadata) {
    throw new HttpsError('not-found', 'The image was not uploaded');
  }
  if (
    metadata.size > DESCRIPTION_IMAGE_MAX_BYTES ||
    !isDescriptionImageType(metadata.contentType)
  ) {
    return {
      kind: 'rejected',
      error: new HttpsError(
        'invalid-argument',
        'The uploaded file is not a PNG, JPEG, GIF or WebP image of at most 10 MB',
      ),
      storagePathToDelete: storagePath,
    };
  }

  const images = currentImages(item.descriptionImages);
  if (images[request.fileId]) {
    throw new HttpsError('already-exists', 'This image is already on the item');
  }
  if (Object.keys(images).length >= DESCRIPTION_IMAGE_MAX_PER_ITEM) {
    return {
      kind: 'rejected',
      error: new HttpsError(
        'failed-precondition',
        `An item can have at most ${DESCRIPTION_IMAGE_MAX_PER_ITEM} description images`,
      ),
      storagePathToDelete: storagePath,
    };
  }

  const image: DescriptionImage = {
    name: request.fileName.slice(0, 255),
    size: metadata.size,
    mimeType: metadata.contentType,
    uploadedAt: nowIso ?? new Date().toISOString(),
    uploadedBy: authUid,
  };
  tx.setDescriptionImage(request.boardId, request.itemId, request.fileId, image);
  return { kind: 'success', result: { fileId: request.fileId, image } };
}

/** Readers of the board get a one-hour signed GET URL, for images the item lists. */
export async function getDescriptionImageUrlInTransaction(
  tx: DescriptionImageTx,
  storageBucket: FileStorageBucket,
  request: GetDescriptionImageUrlRequest,
  authUid: string,
): Promise<GetDescriptionImageUrlResult> {
  const board = await tx.getBoard(request.boardId);
  const workspace = board ? await tx.getWorkspace(board.workspaceId) : null;
  verifyBoardAccess(board, workspace, authUid, false);

  const item = await tx.getItem(request.boardId, request.itemId);
  if (!item || item.state === 'deleted') throw new HttpsError('not-found', 'Item not found');

  if (!currentImages(item.descriptionImages)[request.fileId]) {
    throw new HttpsError('not-found', 'Image not found on this item');
  }
  const { downloadUrl, expiresAt } = await storageBucket.getSignedDownloadUrl(
    descriptionImagePath(request.boardId, request.itemId, request.fileId),
    60 * 60,
  );
  return { url: downloadUrl, expiresAt };
}
