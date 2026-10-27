import { randomUUID } from 'node:crypto';
import type { WorkspaceRole } from '@atrium/shared';
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
