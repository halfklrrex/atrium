import type { Firestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions/v2';
import type { PushDeps, PushTokenStore } from './push';

/** Adapts the Admin SDK (named database via `db()`) to the narrow store `sendPush` reads through. */
export function adminPushTokenStore(firestore: Firestore): PushTokenStore {
  const tokens = (uid: string) => firestore.collection('users').doc(uid).collection('pushTokens');
  return {
    async listTokens(uid) {
      const snap = await tokens(uid).get();
      const refs: { id: string; token: string }[] = [];
      for (const doc of snap.docs) {
        const token: unknown = doc.get('token');
        if (typeof token === 'string' && token) refs.push({ id: doc.id, token });
      }
      return refs;
    },
    async getPrefs(uid) {
      const snap = await firestore.collection('users').doc(uid).get();
      return snap.get('notificationPrefs') ?? undefined;
    },
    async getAccountStatus(uid) {
      const snap = await firestore.collection('users').doc(uid).get();
      const status: unknown = snap.get('accountStatus');
      return status === 'pending' || status === 'approved' || status === 'blocked' ? status : null;
    },
    async deleteToken(uid, tokenId) {
      await tokens(uid).doc(tokenId).delete();
    },
  };
}

export const adminPushDeps = (firestore: Firestore): PushDeps => ({
  store: adminPushTokenStore(firestore),
  messaging: getMessaging(),
  logger,
});
