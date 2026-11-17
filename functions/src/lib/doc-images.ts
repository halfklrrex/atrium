import {
  DOC_IMAGE_MAX_BYTES,
  DOC_IMAGE_MAX_PER_DOC,
  canEditBoard,
  docImagesSchema,
  isDocImageType,
  resolveBoardRole,
  type DocImage,
  type FinalizeDocImageRequest,
  type FinalizeDocImageResult,
  type GetDocImageUrlRequest,
  type GetDocImageUrlResult,
  type RequestDocImageUploadRequest,
  type RequestDocImageUploadResult,
  type WorkspaceRole,
} from '@atrium/shared';
import { HttpsError } from 'firebase-functions/v2/https';
import type { SharingEntity } from './entity-sharing';
import type { FileStorageBucket } from './file-storage';

/** What the doc-image callables need from Firestore (an in-memory fake in the tests). */
export interface DocImageTx {
  getDoc(docId: string): Promise<SharingEntity | null>;
  /** `workspaces/{id}.roles`, or null when the workspace does not exist. */
  getWorkspaceRoles(workspaceId: string): Promise<Record<string, WorkspaceRole> | null>;
  /** The raw `docs/{docId}/content/images` map (undefined when the document does not exist). */
  getImages(docId: string): Promise<unknown>;
  /** Writes `images.<fileId>` as a field path (never the whole map). */
  setImage(docId: string, fileId: string, image: DocImage): void;
  generateFileId?(): string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The only Storage path a doc image may live at; every segment must be a safe id. */
export function docImagePath(docId: string, fileId: string): string {
  for (const segment of [docId, fileId]) {
    if (!SAFE_ID.test(segment)) throw new HttpsError('invalid-argument', 'Invalid image path');
  }
  return `docs/${docId}/images/${fileId}`;
}

/** The images already on the doc. A corrupt map is refused rather than guessed at. */
function currentImages(raw: unknown) {
  const parsed = docImagesSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new HttpsError('failed-precondition', 'Stored doc images are corrupt');
  }
  return parsed.data;
}

/** Same resolver as the rules' `boardRole`: workspace membership, then the doc's own access. */
async function loadDoc(tx: DocImageTx, docId: string, authUid: string, requireEdit: boolean) {
  const doc = await tx.getDoc(docId);
  if (!doc) throw new HttpsError('not-found', 'Doc not found');
  const roles = await tx.getWorkspaceRoles(doc.workspaceId);
  const role = resolveBoardRole(doc, authUid, roles?.[authUid] ?? null);
  if (!role) throw new HttpsError('permission-denied', 'You do not have access to this doc');
  if (requireEdit && !canEditBoard(role)) {
    throw new HttpsError('permission-denied', 'You do not have permission to edit this doc');
  }
  return doc;
}

const tooMany = () =>
  new HttpsError('failed-precondition', `A doc can have at most ${DOC_IMAGE_MAX_PER_DOC} images`);

/** Editors only; the doc must be active; PNG, JPEG, GIF or WebP up to 10 MB; at most 100 per doc. */
export async function requestDocImageUploadInTransaction(
  tx: DocImageTx,
  storageBucket: FileStorageBucket,
  request: RequestDocImageUploadRequest,
  authUid: string,
): Promise<RequestDocImageUploadResult> {
  const doc = await loadDoc(tx, request.docId, authUid, true);
  if (doc.state !== 'active') {
    throw new HttpsError('failed-precondition', 'Cannot add images to a deleted doc');
  }
  if (!isDocImageType(request.contentType)) {
    throw new HttpsError('invalid-argument', 'Only PNG, JPEG, GIF and WebP images can be added');
  }
  if (request.size > DOC_IMAGE_MAX_BYTES) {
    throw new HttpsError('invalid-argument', 'Images can be at most 10 MB');
  }
  const existing = currentImages(await tx.getImages(request.docId));
  if (Object.keys(existing).length >= DOC_IMAGE_MAX_PER_DOC) throw tooMany();

  const fileId = tx.generateFileId ? tx.generateFileId() : crypto.randomUUID().replace(/-/g, '');
  const { uploadUrl, expiresAt, headers } = await storageBucket.getSignedUploadUrl(
    docImagePath(request.docId, fileId),
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

export type FinalizeDocImageOutcome =
  | { kind: 'success'; result: FinalizeDocImageResult }
  | { kind: 'rejected'; error: HttpsError; storagePathToDelete: string };

/**
 * Checks the uploaded object (size and image type from Storage's own metadata) and records it on
 * the doc. A rejected object is returned for the caller to delete AFTER the transaction.
 */
export async function finalizeDocImageInTransaction(
  tx: DocImageTx,
  storageBucket: FileStorageBucket,
  request: FinalizeDocImageRequest,
  authUid: string,
  nowIso?: string,
): Promise<FinalizeDocImageOutcome> {
  const doc = await loadDoc(tx, request.docId, authUid, true);
  if (doc.state !== 'active') {
    throw new HttpsError('failed-precondition', 'Cannot add images to a deleted doc');
  }

  const storagePath = docImagePath(request.docId, request.fileId);
  const metadata = await storageBucket.getFileMetadata(storagePath);
  if (!metadata) throw new HttpsError('not-found', 'The image was not uploaded');
  if (metadata.size > DOC_IMAGE_MAX_BYTES || !isDocImageType(metadata.contentType)) {
    return {
      kind: 'rejected',
      error: new HttpsError(
        'invalid-argument',
        'The uploaded file is not a PNG, JPEG, GIF or WebP image of at most 10 MB',
      ),
      storagePathToDelete: storagePath,
    };
  }

  const images = currentImages(await tx.getImages(request.docId));
  if (images[request.fileId]) {
    throw new HttpsError('already-exists', 'This image is already on the doc');
  }
  if (Object.keys(images).length >= DOC_IMAGE_MAX_PER_DOC) {
    return { kind: 'rejected', error: tooMany(), storagePathToDelete: storagePath };
  }

  const image: DocImage = {
    name: request.fileName.slice(0, 255),
    size: metadata.size,
    mimeType: metadata.contentType,
    uploadedAt: nowIso ?? new Date().toISOString(),
    uploadedBy: authUid,
  };
  tx.setImage(request.docId, request.fileId, image);
  return { kind: 'success', result: { fileId: request.fileId, image } };
}

/** Readers of the doc get a one-hour signed GET URL, for images the doc lists. */
export async function getDocImageUrlInTransaction(
  tx: DocImageTx,
  storageBucket: FileStorageBucket,
  request: GetDocImageUrlRequest,
  authUid: string,
): Promise<GetDocImageUrlResult> {
  const doc = await loadDoc(tx, request.docId, authUid, false);
  if (doc.state === 'deleted') throw new HttpsError('not-found', 'Doc not found');

  if (!currentImages(await tx.getImages(request.docId))[request.fileId]) {
    throw new HttpsError('not-found', 'Image not found on this doc');
  }
  const { downloadUrl, expiresAt } = await storageBucket.getSignedDownloadUrl(
    docImagePath(request.docId, request.fileId),
    60 * 60,
  );
  return { url: downloadUrl, expiresAt };
}
