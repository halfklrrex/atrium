import { ADMIN_CLAIM, type AccountStatus } from '@atrium/shared';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { adminBootstrapTx } from './admin';
import type { AccountAuth, AccountStore, AuthAccount } from './account-admin';
import { bootstrapUserInTransaction } from './bootstrap';
import { adminInboxStore } from './admin-inbox';
import { adminNotificationStore } from './admin-notifications';
import { closeOpenAppeals } from './inbox';

const iso = (value: string | undefined): string | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

function toAccount(user: UserRecord): AuthAccount {
  return {
    uid: user.uid,
    displayName: user.displayName ?? null,
    email: user.email ?? null,
    photoURL: user.photoURL ?? null,
    disabled: user.disabled,
    claims: (user.customClaims as Record<string, unknown> | undefined) ?? {},
    createdAt: iso(user.metadata.creationTime),
    lastSignInAt: iso(user.metadata.lastSignInTime),
  };
}

/** Adapts the Admin SDK Auth to the narrow interface the account logic uses. */
export function adminAccountAuth(): AccountAuth {
  const auth = getAuth();
  return {
    async getUser(uid) {
      try {
        return toAccount(await auth.getUser(uid));
      } catch (error) {
        if ((error as { code?: unknown }).code === 'auth/user-not-found') return null;
        throw error;
      }
    },
    async setClaims(uid, claims) {
      await auth.setCustomUserClaims(uid, claims);
    },
    async revokeRefreshTokens(uid) {
      await auth.revokeRefreshTokens(uid);
    },
    async setDisabled(uid, disabled) {
      await auth.updateUser(uid, { disabled });
    },
    async listUsers(pageSize, pageToken) {
      const page = await auth.listUsers(pageSize, pageToken);
      return { users: page.users.map(toAccount), nextPageToken: page.pageToken ?? null };
    },
    async listAdminUids() {
      const admins: string[] = [];
      let token: string | undefined;
      do {
        const page = await auth.listUsers(1000, token);
        for (const user of page.users) {
          if ((user.customClaims as Record<string, unknown> | undefined)?.[ADMIN_CLAIM] === true) {
            admins.push(user.uid);
          }
        }
        token = page.pageToken;
      } while (token);
      return admins;
    },
  };
}

/** Adapts Firestore to the account store. `system/accountAudit/entries` is Admin SDK only. */
export function adminAccountStore(firestore: Firestore): AccountStore {
  return {
    async getAccountStatuses(uids) {
      const result = new Map<string, AccountStatus>();
      if (uids.length === 0) return result;
      const snaps = await firestore.getAll(
        ...uids.map((uid) => firestore.collection('users').doc(uid)),
        { fieldMask: ['accountStatus'] },
      );
      for (const snap of snaps) {
        const status: unknown = snap.get('accountStatus');
        if (status === 'pending' || status === 'approved' || status === 'blocked') {
          result.set(snap.id, status);
        }
      }
      return result;
    },
    async ensurePersonalWorkspace(identity) {
      const result = await firestore.runTransaction((tx) =>
        bootstrapUserInTransaction(
          adminBootstrapTx(firestore, tx),
          identity,
          {},
          FieldValue.serverTimestamp(),
          { approvalRequired: false },
        ),
      );
      if (!result.workspaceId) throw new Error('Personal workspace was not created.');
      return result.workspaceId;
    },
    async setAccountStatus(uid, status, changedBy) {
      await firestore.collection('users').doc(uid).update({
        accountStatus: status,
        statusChangedAt: FieldValue.serverTimestamp(),
        statusChangedBy: changedBy,
      });
    },
    async appendAudit(entry) {
      await firestore
        .collection('system')
        .doc('accountAudit')
        .collection('entries')
        .add({ ...entry, at: FieldValue.serverTimestamp() });
    },
    async deletePushTokens(uid) {
      const tokens = firestore.collection('users').doc(uid).collection('pushTokens');
      await firestore.recursiveDelete(tokens);
    },
    closeOpenAppeals: (uid) => closeOpenAppeals({ store: adminInboxStore(firestore) }, uid),
    createNotification: (uid, id, data) =>
      adminNotificationStore(firestore).createNotification(uid, id, data),
  };
}
