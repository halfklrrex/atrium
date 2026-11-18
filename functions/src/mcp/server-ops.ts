import { McpUserError, type ServerOps } from '@atrium/mcp-core';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';
import { adminFileStorageBucket, adminUpdateAttachmentTx, db } from '../lib/admin';
import {
  deleteFileAttachmentInTransaction,
  finalizeFileUploadInTransaction,
  getFileDownloadUrlInTransaction,
  requestFileUploadInTransaction,
  type FileStorageBucket,
} from '../lib/file-storage';
import {
  deleteUpdateAttachmentInTransaction,
  getUpdateAttachmentUrlInTransaction,
  type UpdateAttachmentTx,
} from '../lib/update-attachments';

/**
 * The hosted connector's server operations (batch 3 PR 1): the file tools' Cloud Storage work. Each
 * method calls the **existing** library function of the matching callable, with the callables' own
 * Admin store and bucket adapters and the actor's uid as the caller, so the role, lock, size, type
 * and path checks are the callables' own and nothing is copied. A `HttpsError` becomes an
 * `McpUserError` (the callables' messages are written for people); anything else stays unexpected.
 */
export interface ServerOpsDeps {
  /** Runs `fn` in a Firestore transaction with the callables' store adapter. */
  runTransaction<T>(fn: (tx: UpdateAttachmentTx) => Promise<T>): Promise<T>;
  bucket: FileStorageBucket;
  /** Writes an object directly (the connector sends bytes instead of using an upload URL). */
  putObject(storagePath: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

const USER_CODES = new Set([
  'not-found',
  'permission-denied',
  'invalid-argument',
  'failed-precondition',
  'already-exists',
]);

async function asUserError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpsError && USER_CODES.has(error.code)) {
      throw new McpUserError(error.message);
    }
    throw error;
  }
}

export function createServerOps(deps: ServerOpsDeps): ServerOps {
  const { runTransaction, bucket, putObject } = deps;
  return {
    getFileLink: (args) =>
      asUserError(async () => {
        const { uid, boardId, itemId, fileId } = args;
        const result =
          args.updateId !== undefined
            ? await runTransaction((tx) =>
                getUpdateAttachmentUrlInTransaction(
                  tx,
                  bucket,
                  { boardId, itemId, updateId: args.updateId!, replyId: args.replyId, fileId },
                  uid,
                ),
              )
            : await runTransaction((tx) =>
                getFileDownloadUrlInTransaction(
                  tx,
                  bucket,
                  { boardId, itemId, columnId: args.columnId ?? '', fileId },
                  uid,
                ),
              );
        return { url: result.downloadUrl, expiresAt: result.expiresAt };
      }),

    uploadFile: (args) =>
      asUserError(async () => {
        const { uid, boardId, itemId, columnId, name, contentType, bytes } = args;
        // The same checks as `requestFileUpload`, minus the signed URL (the bytes are already here).
        const noUrlBucket: FileStorageBucket = {
          ...bucket,
          getSignedUploadUrl: async () => ({ uploadUrl: '', expiresAt: 0 }),
        };
        const slot = await runTransaction((tx) =>
          requestFileUploadInTransaction(
            tx,
            noUrlBucket,
            { boardId, itemId, columnId, fileName: name, contentType, size: bytes.length },
            uid,
          ),
        );
        await putObject(slot.storagePath, bytes, contentType);
        try {
          const outcome = await runTransaction((tx) =>
            finalizeFileUploadInTransaction(
              tx,
              bucket,
              { boardId, itemId, columnId, fileId: slot.fileId, fileName: name },
              uid,
            ),
          );
          if (outcome.kind === 'rejected') {
            await bucket.deleteFile(outcome.storagePathToDelete);
            throw outcome.error;
          }
          return { file: outcome.file, filesInCell: outcome.columnValue.files.length };
        } catch (error) {
          // A failed finalize leaves an object no cell lists; remove it now (the sweeper is the backstop).
          await bucket.deleteFile(slot.storagePath).catch(() => undefined);
          throw error;
        }
      }),

    deleteFile: (args) =>
      asUserError(async () => {
        const { uid, boardId, itemId, fileId } = args;
        if (args.updateId !== undefined) {
          const { result, storagePathToDelete } = await runTransaction((tx) =>
            deleteUpdateAttachmentInTransaction(
              tx,
              { boardId, itemId, updateId: args.updateId!, replyId: args.replyId, fileId },
              uid,
            ),
          );
          await bucket.deleteFile(storagePathToDelete);
          return { remaining: result.attachments.length };
        }
        const { result, storagePathToDelete } = await runTransaction((tx) =>
          deleteFileAttachmentInTransaction(
            tx,
            { boardId, itemId, columnId: args.columnId ?? '', fileId },
            uid,
          ),
        );
        await bucket.deleteFile(storagePathToDelete);
        return { remaining: result.columnValue.files.length };
      }),
  };
}

/** The production wiring: the named Firestore database and the default Storage bucket. */
export function adminServerOps(): ServerOps {
  return createServerOps({
    runTransaction: (fn) => {
      const firestore = db();
      return firestore.runTransaction((tx) => fn(adminUpdateAttachmentTx(firestore, tx)));
    },
    bucket: adminFileStorageBucket(),
    putObject: async (storagePath, bytes, contentType) => {
      await getStorage()
        .bucket()
        .file(storagePath)
        .save(Buffer.from(bytes), { contentType, resumable: false });
    },
  });
}
