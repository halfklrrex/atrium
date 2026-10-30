import type { WorkspaceRole } from '@atrium/shared';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { NotificationPurgeStore, NotificationStore } from './notifications';

/** gRPC status `ALREADY_EXISTS`, which `create()` rejects with when the document is there. */
const ALREADY_EXISTS = 6;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

/** Adapts the Admin SDK to the narrow store the notification logic reads and writes through. */
export function adminNotificationStore(firestore: Firestore): NotificationStore {
  return {
    async getBoard(boardId) {
      const snap = await firestore.collection('boards').doc(boardId).get();
      if (!snap.exists) return null;
      return {
        name: str(snap.get('name')) ?? '',
        kind: snap.get('kind'),
        workspaceId: str(snap.get('workspaceId')) ?? '',
        access: snap.get('access') ?? {},
        columns: snap.get('columns') ?? [],
        subitemColumns: snap.get('subitemColumns') ?? [],
      };
    },
    async getWorkspaceRoles(workspaceId) {
      if (!workspaceId) return {};
      const snap = await firestore.collection('workspaces').doc(workspaceId).get();
      return (snap.get('roles') as Record<string, WorkspaceRole> | undefined) ?? {};
    },
    async getPrefs(uid) {
      const snap = await firestore.collection('users').doc(uid).get();
      return snap.get('notificationPrefs') ?? undefined;
    },
    async getMemberProfile(workspaceId, uid) {
      const snap = await firestore
        .collection('workspaces')
        .doc(workspaceId)
        .collection('members')
        .doc(uid)
        .get();
      if (!snap.exists) return null;
      const photo: unknown = snap.get('photoURL');
      return {
        name: str(snap.get('displayName')) ?? '',
        photoURL: typeof photo === 'string' && photo ? photo : null,
      };
    },
    async getItemName(boardId, itemId) {
      const snap = await firestore
        .collection('boards')
        .doc(boardId)
        .collection('items')
        .doc(itemId)
        .get();
      return snap.exists ? (str(snap.get('name')) ?? '') : null;
    },
    async getUpdateAuthorId(boardId, itemId, updateId) {
      const snap = await firestore
        .collection('boards')
        .doc(boardId)
        .collection('items')
        .doc(itemId)
        .collection('updates')
        .doc(updateId)
        .get();
      return snap.exists ? (str(snap.get('authorId')) ?? null) : null;
    },
    async createNotification(uid, id, data) {
      const ref = firestore.collection('users').doc(uid).collection('notifications').doc(id);
      try {
        await ref.create({ ...data, createdAt: FieldValue.serverTimestamp(), readAt: null });
        return true;
      } catch (error) {
        // A retried trigger: the notification (and any `readAt` the user set) stays as it is.
        if ((error as { code?: unknown }).code === ALREADY_EXISTS) return false;
        throw error;
      }
    },
  };
}

/** Collection-group access for the retention sweep. */
export function adminNotificationPurgeStore(firestore: Firestore): NotificationPurgeStore {
  return {
    async listExpired(cutoff, limit) {
      const snap = await firestore
        .collectionGroup('notifications')
        .where('createdAt', '<', cutoff)
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.ref.path);
    },
    async deletePaths(paths) {
      const batch = firestore.batch();
      for (const path of paths) batch.delete(firestore.doc(path));
      await batch.commit();
    },
  };
}
