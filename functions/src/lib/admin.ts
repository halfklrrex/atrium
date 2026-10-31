import { randomUUID } from 'node:crypto';
import type { BoardRole, WorkspaceRole } from '@atrium/shared';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  FieldValue,
  getFirestore,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { FIRESTORE_DATABASE_ID } from '@atrium/shared';
import type { Board, Item, Workspace } from '@atrium/shared';
import { getStorage } from 'firebase-admin/storage';
import type { BootstrapTx } from './bootstrap';
import type { FileStorageBucket, FileStorageTx, StorageFileMetadata } from './file-storage';
import type { DescriptionImageTx } from './description-images';
import type { ColumnActionsTx } from './column-actions';
import {
  DELETE_VALUE,
  type ChangeBoardData,
  type ColumnTypeChangeStore,
  type SnapshotEntry,
  type SnapshotMeta,
} from './column-type-change';
import type { BoardSharingTx } from './board-sharing';
import { HttpsError } from 'firebase-functions/v2/https';

if (getApps().length === 0) initializeApp();

/** Lazily-created Firestore handle (keeps module import free of side effects beyond app init). */
export const db = (): Firestore => getFirestore(FIRESTORE_DATABASE_ID);

/** Adapts an Admin SDK transaction to the narrow interface used by the bootstrap logic. */
export function adminBootstrapTx(firestore: Firestore, tx: Transaction): BootstrapTx {
  const userRef = (uid: string) => firestore.collection('users').doc(uid);
  const workspaceRef = (id: string) => firestore.collection('workspaces').doc(id);

  return {
    async getUser(uid) {
      const snap = await tx.get(userRef(uid));
      if (!snap.exists) return null;
      const last: unknown = snap.get('lastWorkspaceId');
      return { lastWorkspaceId: typeof last === 'string' && last ? last : null };
    },
    async workspaceHasMember(workspaceId, uid) {
      const snap = await tx.get(workspaceRef(workspaceId));
      const memberIds: unknown = snap.get('memberIds');
      return snap.exists && Array.isArray(memberIds) && memberIds.includes(uid);
    },
    async findMemberWorkspaceId(uid) {
      const snap = await tx.get(
        firestore.collection('workspaces').where('memberIds', 'array-contains', uid).limit(1),
      );
      return snap.docs[0]?.id ?? null;
    },
    newWorkspaceId: () => firestore.collection('workspaces').doc().id,
    createUser: (uid, data) => void tx.create(userRef(uid), data),
    setLastWorkspace: (uid, workspaceId) =>
      void tx.update(userRef(uid), { lastWorkspaceId: workspaceId }),
    createWorkspace: (id, data) => void tx.create(workspaceRef(id), data),
    createMember: (workspaceId, uid, profile) =>
      void tx.create(workspaceRef(workspaceId).collection('members').doc(uid), {
        ...profile,
        role: 'owner',
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
  };
}

/** Adapts an Admin SDK transaction to the FileStorageTx interface. */
export function adminFileStorageTx(firestore: Firestore, tx: Transaction): FileStorageTx {
  return {
    async getBoard(boardId: string): Promise<Board | null> {
      const snap = await tx.get(firestore.collection('boards').doc(boardId));
      if (!snap.exists) return null;
      return snap.data() as Board;
    },
    async getWorkspace(workspaceId: string): Promise<Workspace | null> {
      const snap = await tx.get(firestore.collection('workspaces').doc(workspaceId));
      if (!snap.exists) return null;
      return snap.data() as Workspace;
    },
    async getItem(boardId: string, itemId: string): Promise<Item | null> {
      const snap = await tx.get(
        firestore.collection('boards').doc(boardId).collection('items').doc(itemId),
      );
      if (!snap.exists) return null;
      return snap.data() as Item;
    },
    updateItemValues(boardId: string, itemId: string, values: Record<string, unknown>): void {
      const itemRef = firestore.collection('boards').doc(boardId).collection('items').doc(itemId);
      for (const [colId, val] of Object.entries(values)) {
        tx.update(itemRef, new FieldPath('values', colId), val);
      }
    },
  };
}

/** The files transaction plus the description-image field-path write. */
export function adminDescriptionImageTx(firestore: Firestore, tx: Transaction): DescriptionImageTx {
  return {
    ...adminFileStorageTx(firestore, tx),
    setDescriptionImage(boardId, itemId, fileId, image) {
      const itemRef = firestore.collection('boards').doc(boardId).collection('items').doc(itemId);
      tx.update(itemRef, new FieldPath('descriptionImages', fileId), image);
    },
  };
}

/** Cloud Storage bucket adapter for file verification and cleanup. */
export function adminFileStorageBucket(): FileStorageBucket {
  return {
    async getFileMetadata(storagePath: string): Promise<StorageFileMetadata | null> {
      const bucket = getStorage().bucket();
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [metadata] = await file.getMetadata();
      return {
        size: Number(metadata.size ?? 0),
        contentType: String(metadata.contentType ?? 'application/octet-stream'),
        timeCreated: String(metadata.timeCreated ?? new Date().toISOString()),
      };
    },
    async deleteFile(storagePath: string): Promise<void> {
      const bucket = getStorage().bucket();
      const file = bucket.file(storagePath);
      await file.delete({ ignoreNotFound: true });
    },
    async getSignedUploadUrl(
      storagePath: string,
      contentType: string,
      size: number,
      expiresInSeconds: number,
    ): Promise<{ uploadUrl: string; expiresAt: number; headers: Record<string, string> }> {
      const bucket = getStorage().bucket();
      const file = bucket.file(storagePath);
      const expiresAt = Date.now() + expiresInSeconds * 1000;
      const extensionHeaders = {
        'x-goog-content-length-range': `0,${size}`,
      };
      const [uploadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: expiresAt,
        contentType,
        extensionHeaders,
      });
      return {
        uploadUrl,
        expiresAt,
        headers: {
          'content-type': contentType,
          ...extensionHeaders,
        },
      };
    },
    async getSignedDownloadUrl(
      storagePath: string,
      expiresInSeconds: number,
    ): Promise<{ downloadUrl: string; expiresAt: number }> {
      const bucket = getStorage().bucket();
      const file = bucket.file(storagePath);
      const expiresAt = Date.now() + expiresInSeconds * 1000;
      const [downloadUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: expiresAt,
      });
      return { downloadUrl, expiresAt };
    },
    async listUploadFiles(
      prefix = 'boards/',
    ): Promise<Array<{ name: string; timeCreated: string }>> {
      const bucket = getStorage().bucket();
      const [files] = await bucket.getFiles({ prefix });
      return files.map((f) => ({
        name: f.name,
        timeCreated: f.metadata.timeCreated
          ? String(f.metadata.timeCreated)
          : new Date().toISOString(),
      }));
    },
  };
}

/** Adapts an Admin SDK transaction to the ColumnActionsTx interface. */
export function adminColumnActionsTx(firestore: Firestore, tx: Transaction): ColumnActionsTx {
  const boardRef = (boardId: string) => firestore.collection('boards').doc(boardId);
  const workspaceRef = (workspaceId: string) => firestore.collection('workspaces').doc(workspaceId);
  const itemRef = (boardId: string, itemId: string) =>
    firestore.collection('boards').doc(boardId).collection('items').doc(itemId);
  const activityCol = (boardId: string) =>
    firestore.collection('boards').doc(boardId).collection('activity');

  return {
    async getBoard(boardId) {
      const snap = await tx.get(boardRef(boardId));
      if (!snap.exists) return null;
      return {
        kind: snap.get('kind'),
        workspaceId: snap.get('workspaceId'),
        access: snap.get('access') ?? {},
        columns: snap.get('columns') ?? [],
        columnLocks: snap.get('columnLocks') ?? [],
      };
    },
    async getWorkspaceMemberRole(workspaceId, uid) {
      const snap = await tx.get(workspaceRef(workspaceId));
      if (!snap.exists) return null;
      const roles = snap.get('roles') as Record<string, WorkspaceRole> | undefined;
      return roles?.[uid] ?? null;
    },
    async getItem(boardId, itemId) {
      const snap = await tx.get(itemRef(boardId, itemId));
      if (!snap.exists) return null;
      return {
        id: snap.id,
        name: snap.get('name') ?? '',
        state: snap.get('state') ?? 'active',
        values: snap.get('values') ?? {},
      };
    },
    updateItemValues(boardId, itemId, columnId, value, updatedBy, serverTimestamp) {
      tx.update(
        itemRef(boardId, itemId),
        new FieldPath('values', columnId),
        value,
        'updatedAt',
        serverTimestamp,
        'updatedBy',
        updatedBy,
      );
    },
    async appendActivity(boardId, activity) {
      const newDoc = activityCol(boardId).doc();
      tx.create(newDoc, activity);
      return newDoc.id;
    },
    nowMs: () => Date.now(),
    newSessionId: () => randomUUID(),
  };
}

/** Plain JSON copy: Firestore rejects `undefined` anywhere in a document. */
const jsonClean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Admin Firestore adapter for `changeColumnType` / `revertColumnType` (see column-type-change.ts). */
export function adminColumnTypeChangeStore(firestore: Firestore): ColumnTypeChangeStore {
  const boardRef = (boardId: string) => firestore.collection('boards').doc(boardId);
  const snapRef = (boardId: string, snapshotId: string) =>
    boardRef(boardId).collection('columnSnapshots').doc(snapshotId);
  const chunksCol = (boardId: string, snapshotId: string) =>
    snapRef(boardId, snapshotId).collection('chunks');
  const toBoardData = (data: FirebaseFirestore.DocumentData): ChangeBoardData => ({
    kind: data.kind,
    workspaceId: data.workspaceId,
    access: data.access ?? {},
    columns: data.columns ?? [],
    subitemColumns: data.subitemColumns ?? [],
    columnLocks: data.columnLocks ?? [],
  });

  return {
    async getBoard(boardId) {
      const snap = await boardRef(boardId).get();
      return snap.exists ? toBoardData(snap.data() ?? {}) : null;
    },
    async getWorkspaceMemberRole(workspaceId, uid) {
      const snap = await firestore.collection('workspaces').doc(workspaceId).get();
      if (!snap.exists) return null;
      const roles = snap.get('roles') as Record<string, WorkspaceRole> | undefined;
      return roles?.[uid] ?? null;
    },
    async getMemberNames(workspaceId) {
      const snap = await firestore
        .collection('workspaces')
        .doc(workspaceId)
        .collection('members')
        .get();
      const names: Record<string, string> = {};
      for (const doc of snap.docs) {
        const name: unknown = doc.get('displayName');
        if (typeof name === 'string' && name.trim()) names[doc.id] = name;
      }
      return names;
    },
    async listItems(boardId) {
      const snap = await boardRef(boardId)
        .collection('items')
        .orderBy(FieldPath.documentId())
        .get();
      return snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          parentItemId: (data.parentItemId as string | null | undefined) ?? null,
          values: (data.values as Record<string, unknown> | undefined) ?? {},
          meta: {
            createdAt: data.createdAt,
            createdBy: data.createdBy,
            updatedAt: data.updatedAt,
            updatedBy: data.updatedBy,
            groupId: data.groupId,
            seq: data.seq,
            boardSeq: data.boardSeq,
          },
        };
      });
    },
    async getSnapshot(boardId, snapshotId) {
      const snap = await snapRef(boardId, snapshotId).get();
      return snap.exists ? (snap.data() as SnapshotMeta) : null;
    },
    async setSnapshot(boardId, snapshotId, meta) {
      await snapRef(boardId, snapshotId).set(jsonClean(meta));
    },
    async deleteSnapshotChunks(boardId, snapshotId) {
      const snap = await chunksCol(boardId, snapshotId).get();
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = firestore.batch();
        for (const doc of snap.docs.slice(i, i + 400)) batch.delete(doc.ref);
        await batch.commit();
      }
    },
    async writeSnapshotChunk(boardId, snapshotId, index, entries) {
      await chunksCol(boardId, snapshotId)
        .doc(String(index).padStart(6, '0'))
        .set(jsonClean({ index, entries }));
    },
    async readSnapshotChunks(boardId, snapshotId) {
      const snap = await chunksCol(boardId, snapshotId).orderBy('index').get();
      return snap.docs.map((doc) => (doc.get('entries') ?? []) as SnapshotEntry[]);
    },
    async updateColumn(boardId, scope, columnId, decide, snapshotPatch) {
      await firestore.runTransaction(async (tx) => {
        const ref = boardRef(boardId);
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', 'Board not found.');
        const board = toBoardData(snap.data() ?? {});
        const list = scope === 'columns' ? board.columns : board.subitemColumns;
        const current = list.find((c) => c.id === columnId) ?? null;
        const next = decide(current, board);
        if (next === current) return;
        tx.update(ref, {
          [scope]: list.map((c) => (c.id === columnId ? next : c)),
          updatedAt: FieldValue.serverTimestamp(),
        });
        if (snapshotPatch) {
          tx.update(snapRef(boardId, snapshotPatch.snapshotId), jsonClean(snapshotPatch.patch));
        }
      });
    },
    async writeValues(boardId, columnId, writes) {
      if (writes.length === 0) return;
      const refs = writes.map((w) => boardRef(boardId).collection('items').doc(w.itemId));
      const snaps = await firestore.getAll(...refs);
      const batch = firestore.batch();
      writes.forEach((write, i) => {
        if (!snaps[i]?.exists) return;
        batch.update(
          refs[i]!,
          new FieldPath('values', columnId),
          write.value === DELETE_VALUE ? FieldValue.delete() : write.value,
        );
      });
      await batch.commit();
    },
    nowMs: () => Date.now(),
    newId: () => randomUUID().replace(/-/g, '').slice(0, 24),
  };
}

/** Adapts an Admin SDK transaction to the narrow interface used by the board sharing callables. */
export function adminBoardSharingTx(firestore: Firestore, tx: Transaction): BoardSharingTx {
  const boardRef = (id: string) => firestore.collection('boards').doc(id);
  return {
    async getBoard(boardId) {
      const snap = await tx.get(boardRef(boardId));
      if (!snap.exists) return null;
      return {
        workspaceId: String(snap.get('workspaceId') ?? ''),
        kind: snap.get('kind'),
        access: (snap.get('access') as Record<string, BoardRole> | undefined) ?? {},
        state: snap.get('state') ?? 'active',
      };
    },
    async getWorkspaceRoles(workspaceId) {
      const snap = await tx.get(firestore.collection('workspaces').doc(workspaceId));
      if (!snap.exists) return null;
      return (snap.get('roles') as Record<string, WorkspaceRole> | undefined) ?? {};
    },
    writeSharing(boardId, next) {
      tx.update(boardRef(boardId), {
        kind: next.kind,
        access: next.access,
        accessUids: Object.keys(next.access),
        updatedAt: FieldValue.serverTimestamp(),
      });
    },
  };
}
