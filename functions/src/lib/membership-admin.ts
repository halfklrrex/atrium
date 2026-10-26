import type { WorkspaceRole } from '@atrium/shared';
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import type {
  BoardAccessStore,
  InviteData,
  InviteReader,
  MemberProfile,
  MemberProfileStore,
  MembershipTx,
  WorkspaceData,
} from './membership';

const workspaceRef = (firestore: Firestore, workspaceId: string) =>
  firestore.collection('workspaces').doc(workspaceId);
const membersCol = (firestore: Firestore, workspaceId: string) =>
  workspaceRef(firestore, workspaceId).collection('members');
const invitesCol = (firestore: Firestore, workspaceId: string) =>
  workspaceRef(firestore, workspaceId).collection('invites');

const millis = (value: unknown): number =>
  value instanceof Timestamp ? value.toMillis() : typeof value === 'number' ? value : 0;

function toInvite(data: DocumentData): InviteData {
  return {
    email: String(data.email ?? ''),
    role: data.role,
    invitedBy: String(data.invitedBy ?? ''),
    invitedByName: String(data.invitedByName ?? ''),
    workspaceName: String(data.workspaceName ?? ''),
    createdAtMs: millis(data.createdAt),
    expiresAtMs: millis(data.expiresAt),
    status: data.status,
  };
}

/** Adapts an Admin SDK transaction to the MembershipTx interface. */
export function adminMembershipTx(firestore: Firestore, tx: Transaction): MembershipTx {
  const wsRef = (id: string) => workspaceRef(firestore, id);
  const memberRef = (workspaceId: string, uid: string) =>
    membersCol(firestore, workspaceId).doc(uid);

  return {
    async getWorkspace(workspaceId): Promise<WorkspaceData | null> {
      const snap = await tx.get(wsRef(workspaceId));
      if (!snap.exists) return null;
      return {
        name: String(snap.get('name') ?? ''),
        ownerId: String(snap.get('ownerId') ?? ''),
        memberIds: (snap.get('memberIds') as string[] | undefined) ?? [],
        roles: (snap.get('roles') as Record<string, WorkspaceRole> | undefined) ?? {},
      };
    },
    async getInvite(workspaceId, inviteId) {
      const snap = await tx.get(invitesCol(firestore, workspaceId).doc(inviteId));
      return snap.exists ? toInvite(snap.data() ?? {}) : null;
    },
    async listPendingInvites(workspaceId) {
      const snap = await tx.get(
        invitesCol(firestore, workspaceId).where('status', '==', 'pending'),
      );
      return snap.docs.map((d) => ({ id: d.id, data: toInvite(d.data()) }));
    },
    async listMembers(workspaceId) {
      const snap = await tx.get(membersCol(firestore, workspaceId));
      return snap.docs.map((d) => ({ uid: d.id, email: String(d.get('email') ?? '') }));
    },
    newInviteId: (workspaceId) => invitesCol(firestore, workspaceId).doc().id,
    createInvite(workspaceId, inviteId, data) {
      tx.create(invitesCol(firestore, workspaceId).doc(inviteId), {
        email: data.email,
        role: data.role,
        invitedBy: data.invitedBy,
        invitedByName: data.invitedByName,
        workspaceName: data.workspaceName,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(data.expiresAtMs),
        status: data.status,
      });
    },
    updateInvite(workspaceId, inviteId, patch) {
      const { expiresAtMs, createdAtMs: _createdAtMs, ...rest } = patch;
      const update: DocumentData = { ...rest };
      if (expiresAtMs !== undefined) update.expiresAt = Timestamp.fromMillis(expiresAtMs);
      tx.update(invitesCol(firestore, workspaceId).doc(inviteId), update);
    },
    addMember(workspaceId, uid, role, profile) {
      tx.update(
        wsRef(workspaceId),
        new FieldPath('roles', uid),
        role,
        'memberIds',
        FieldValue.arrayUnion(uid),
        'updatedAt',
        FieldValue.serverTimestamp(),
      );
      tx.set(memberRef(workspaceId, uid), {
        displayName: profile.displayName,
        photoURL: profile.photoURL,
        email: profile.email,
        role,
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    },
    ensureMemberDoc(workspaceId, uid, role, profile) {
      tx.set(memberRef(workspaceId, uid), {
        displayName: profile.displayName,
        photoURL: profile.photoURL,
        email: profile.email,
        role,
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    },
    setMemberRole(workspaceId, uid, role) {
      tx.update(
        wsRef(workspaceId),
        new FieldPath('roles', uid),
        role,
        'updatedAt',
        FieldValue.serverTimestamp(),
      );
      tx.set(
        memberRef(workspaceId, uid),
        { role, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    },
    transferOwnership(workspaceId, newOwner, oldOwner) {
      tx.update(
        wsRef(workspaceId),
        'ownerId',
        newOwner,
        new FieldPath('roles', newOwner),
        'owner',
        new FieldPath('roles', oldOwner),
        'admin',
        'updatedAt',
        FieldValue.serverTimestamp(),
      );
      tx.set(
        memberRef(workspaceId, newOwner),
        { role: 'owner', updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      tx.set(
        memberRef(workspaceId, oldOwner),
        { role: 'admin', updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    },
    removeMember(workspaceId, uid) {
      tx.update(
        wsRef(workspaceId),
        new FieldPath('roles', uid),
        FieldValue.delete(),
        'memberIds',
        FieldValue.arrayRemove(uid),
        'updatedAt',
        FieldValue.serverTimestamp(),
      );
      tx.delete(memberRef(workspaceId, uid));
    },
  };
}

/** Invite lookups outside a transaction (collection-group query needs the `invites` index). */
export function adminInviteReader(firestore: Firestore): InviteReader {
  const workspaceIdOf = (d: QueryDocumentSnapshot) => d.ref.parent.parent?.id ?? '';
  return {
    async findPendingInvitesByEmail(email) {
      const snap = await firestore
        .collectionGroup('invites')
        .where('email', '==', email)
        .where('status', '==', 'pending')
        .get();
      return snap.docs.map((d) => ({
        workspaceId: workspaceIdOf(d),
        id: d.id,
        data: toInvite(d.data()),
      }));
    },
    async getInvite(workspaceId, inviteId) {
      const snap = await invitesCol(firestore, workspaceId).doc(inviteId).get();
      return snap.exists ? toInvite(snap.data() ?? {}) : null;
    },
  };
}

/** Board housekeeping after a member leaves: strips them from `access` and `accessUids`. */
export function adminBoardAccessStore(firestore: Firestore): BoardAccessStore {
  return {
    async listBoardIdsWithAccess(workspaceId, uid) {
      const snap = await firestore
        .collection('boards')
        .where('workspaceId', '==', workspaceId)
        .where('accessUids', 'array-contains', uid)
        .get();
      return snap.docs.map((d) => d.id);
    },
    async removeAccess(boardIds, uid) {
      const batch = firestore.batch();
      for (const id of boardIds) {
        batch.update(
          firestore.collection('boards').doc(id),
          new FieldPath('access', uid),
          FieldValue.delete(),
          'accessUids',
          FieldValue.arrayRemove(uid),
        );
      }
      await batch.commit();
    },
  };
}

/** Member profile refresh used by `bootstrapUser`. */
export function adminMemberProfileStore(firestore: Firestore): MemberProfileStore {
  const memberRef = (workspaceId: string, uid: string) =>
    membersCol(firestore, workspaceId).doc(uid);
  return {
    async listMemberships(uid, limit) {
      const snap = await firestore
        .collection('workspaces')
        .where('memberIds', 'array-contains', uid)
        .limit(limit)
        .get();
      return snap.docs.flatMap((d) => {
        const role = (d.get('roles') as Record<string, WorkspaceRole> | undefined)?.[uid];
        return role ? [{ workspaceId: d.id, role }] : [];
      });
    },
    async getMemberProfile(workspaceId, uid): Promise<MemberProfile | null> {
      const snap = await memberRef(workspaceId, uid).get();
      if (!snap.exists) return null;
      const photo: unknown = snap.get('photoURL');
      return {
        displayName: String(snap.get('displayName') ?? ''),
        photoURL: typeof photo === 'string' ? photo : null,
        email: String(snap.get('email') ?? ''),
      };
    },
    async upsertMemberProfile(workspaceId, uid, profile, createWithRole) {
      const ref = memberRef(workspaceId, uid);
      if (createWithRole) {
        await ref.set({
          displayName: profile.displayName,
          photoURL: profile.photoURL,
          email: profile.email,
          role: createWithRole,
          joinedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        await ref.update({
          displayName: profile.displayName,
          photoURL: profile.photoURL,
          email: profile.email,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    },
  };
}
