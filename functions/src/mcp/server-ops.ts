import { McpUserError, type ServerOps } from '@atrium/mcp-core';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  DASHBOARD_LIMITS,
  DOC_LIMITS,
  type BoardKind,
  type BoardRole,
  type WorkspaceRole,
} from '@atrium/shared';
import {
  adminBoardSharingTx,
  adminDashboardSharingTx,
  adminDocSharingTx,
  adminFileStorageBucket,
  adminUpdateAttachmentTx,
  db,
} from '../lib/admin';
import {
  setBoardAccessInTransaction,
  setBoardKindInTransaction,
  type BoardSharingTx,
} from '../lib/board-sharing';
import type { DashboardSharingTx } from '../lib/dashboard-sharing';
import { setEntityAccessInTransaction, type EntitySharingTx } from '../lib/entity-sharing';
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
  /** Runs `fn` in one Firestore transaction with the sharing callables' store adapters. */
  runSharing<T>(fn: (stores: SharingStores) => Promise<T>): Promise<T>;
}

/** The three sharing callables' transaction adapters, all bound to the same Firestore transaction. */
export interface SharingStores {
  board: BoardSharingTx;
  doc: EntitySharingTx;
  dashboard: DashboardSharingTx;
}

interface SharingState {
  kind: BoardKind;
  access: Record<string, BoardRole>;
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

/** The workspace's roles and the object's sharing before and after one change (which may be a dry run). */
interface SharingOutcome {
  before: SharingState;
  after: SharingState;
  roles: Record<string, WorkspaceRole>;
}

const stateOf = (e: { kind: BoardKind; access: Record<string, BoardRole> }): SharingState => ({
  kind: e.kind,
  access: { ...e.access },
});

export function createServerOps(deps: ServerOpsDeps): ServerOps {
  const { runTransaction, bucket, putObject, runSharing } = deps;
  return {
    setAccess: (args) =>
      asUserError(() =>
        runSharing(async (stores): Promise<SharingOutcome> => {
          const { uid, id, kind, person, dryRun } = args;
          let before: SharingState | undefined;
          let roles: Record<string, WorkspaceRole> = {};
          let pending: SharingState | undefined;
          const rolesOf = async (
            read: (workspaceId: string) => Promise<Record<string, WorkspaceRole> | null>,
            workspaceId: string,
          ) => {
            const found = await read(workspaceId);
            if (found) roles = found;
            return found;
          };
          // Writes are held back until the library has finished reading (a Firestore transaction
          // reads before it writes) and are dropped for a dry run.
          const flush = (write: () => void) => {
            if (!dryRun) write();
          };
          if (args.target === 'doc' || args.target === 'dashboard') {
            const entityTx: EntitySharingTx =
              args.target === 'doc'
                ? stores.doc
                : {
                    getEntity: (entityId) => stores.dashboard.getDashboard(entityId),
                    getWorkspaceRoles: (w) => stores.dashboard.getWorkspaceRoles(w),
                    writeSharing: (a, b, c) => stores.dashboard.writeSharing(a, b, c),
                  };
            const wrapped: EntitySharingTx = {
              getEntity: async (entityId) => {
                const found = await entityTx.getEntity(entityId);
                if (found) before ??= stateOf(found);
                return found;
              },
              getWorkspaceRoles: (w) => rolesOf((x) => entityTx.getWorkspaceRoles(x), w),
              writeSharing: (a, next, c) => {
                pending = stateOf(next);
                flush(() => entityTx.writeSharing(a, next, c));
              },
            };
            const noun = args.target;
            const result = await setEntityAccessInTransaction(
              {
                noun,
                accessEntries:
                  noun === 'doc' ? DOC_LIMITS.accessEntries : DASHBOARD_LIMITS.accessEntries,
              },
              wrapped,
              uid,
              { id, kind, person },
            );
            return { before: before!, after: pending ?? stateOf(result), roles };
          }

          // Boards: a kind change and a person change are two library calls, so the second one reads
          // the state the first would have written, and everything is written at the end.
          const base = stores.board;
          const activity: Parameters<BoardSharingTx['appendActivity']>[] = [];
          const buffered: BoardSharingTx = {
            getBoard: async (boardId) => {
              const found = await base.getBoard(boardId);
              if (!found) return found;
              before ??= stateOf(found);
              return pending ? { ...found, ...pending, access: { ...pending.access } } : found;
            },
            getWorkspaceRoles: (w) => rolesOf((x) => base.getWorkspaceRoles(x), w),
            writeSharing: (_boardId, next) => {
              pending = stateOf(next);
            },
            getMemberProfiles: (w, uids) => base.getMemberProfiles(w, uids),
            appendActivity: (boardId, docs) => {
              activity.push([boardId, docs]);
            },
          };
          const current = await buffered.getBoard(id);
          if (!current) throw new HttpsError('not-found', 'Board not found.');
          let last: { kind: BoardKind; access: Record<string, BoardRole> } = current;
          if (kind !== undefined && kind !== current.kind) {
            last = await setBoardKindInTransaction(buffered, uid, { boardId: id, kind });
          }
          if (person) {
            last = await setBoardAccessInTransaction(buffered, uid, {
              boardId: id,
              uid: person.uid,
              role: person.role,
            });
          }
          const after = pending ?? stateOf(last);
          if (pending && !dryRun) {
            base.writeSharing(id, pending, uid);
            for (const [boardId, docs] of activity) base.appendActivity(boardId, docs);
          }
          return { before: before!, after, roles };
        }),
      ),

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
    runSharing: (fn) => {
      const firestore = db();
      return firestore.runTransaction((tx) =>
        fn({
          board: adminBoardSharingTx(firestore, tx),
          doc: adminDocSharingTx(firestore, tx),
          dashboard: adminDashboardSharingTx(firestore, tx),
        }),
      );
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
