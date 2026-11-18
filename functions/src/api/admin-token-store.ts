import { randomUUID } from 'node:crypto';
import type { AccountStatus } from '@atrium/shared';
import { Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import type { ApiTokenDoc, ApiTokenIndexDoc, ApiTokenStore } from './token-store';

/**
 * Adapts the Admin SDK (named database via `db()`) to `ApiTokenStore`. Every `*At` field is stored
 * as a Firestore `Timestamp` (the TTL policy on `apiTokenIndex.expiresAt` needs one) and read back as
 * epoch milliseconds.
 */

export const API_TOKENS = 'apiTokens';
export const API_TOKEN_INDEX = 'apiTokenIndex';

const TIME_KEYS = new Set(['createdAt', 'expiresAt', 'lastUsedAt', 'revokedAt']);

function toFirestore(doc: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    out[key] =
      TIME_KEYS.has(key) && typeof value === 'number' ? Timestamp.fromMillis(value) : value;
  }
  return out;
}

function fromFirestore<T>(snap: DocumentSnapshot): T | null {
  const data = snap.data();
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = TIME_KEYS.has(key) && value instanceof Timestamp ? value.toMillis() : value;
  }
  return out as T;
}

export function adminApiTokenStore(firestore: Firestore): ApiTokenStore {
  const users = firestore.collection('users');
  const tokens = (uid: string) => users.doc(uid).collection(API_TOKENS);
  const index = firestore.collection(API_TOKEN_INDEX);

  return {
    async getIndex(hash) {
      return fromFirestore<ApiTokenIndexDoc>(await index.doc(hash).get());
    },
    async getToken(uid, tokenId) {
      return fromFirestore<ApiTokenDoc>(await tokens(uid).doc(tokenId).get());
    },
    async listUnrevokedTokens(uid) {
      const snap = await tokens(uid).where('revokedAt', '==', null).get();
      return snap.docs.map((d) => ({ uid, tokenId: d.id, doc: fromFirestore<ApiTokenDoc>(d)! }));
    },
    async getAccountStatus(uid) {
      const status: unknown = (await users.doc(uid).get()).get('accountStatus');
      return status === 'pending' || status === 'approved' || status === 'blocked'
        ? (status as AccountStatus)
        : null;
    },
    async isWorkspaceMember(uid, workspaceId) {
      const snap = await firestore.collection('workspaces').doc(workspaceId).get();
      const roles: unknown = snap.get('roles');
      return typeof roles === 'object' && roles !== null && uid in roles;
    },
    async createTokenIfRoom({ uid, tokenId, doc, hash, index: indexDoc, now, maxActive }) {
      return firestore.runTransaction(async (tx) => {
        const existing = await tx.get(tokens(uid).where('revokedAt', '==', null));
        const active = existing.docs.filter((d) => {
          const expiresAt: unknown = d.get('expiresAt');
          return expiresAt instanceof Timestamp && expiresAt.toMillis() > now;
        });
        if (active.length >= maxActive) return false;
        tx.create(tokens(uid).doc(tokenId), toFirestore(doc));
        tx.create(index.doc(hash), toFirestore(indexDoc));
        return true;
      });
    },
    async revokeToken(uid, tokenId, now) {
      await tokens(uid)
        .doc(tokenId)
        .update({ revokedAt: Timestamp.fromMillis(now) });
      const hashes = await index
        .where('uid', '==', uid)
        .where('tokenId', '==', tokenId)
        .select()
        .get();
      if (hashes.empty) return;
      const batch = firestore.batch();
      for (const d of hashes.docs) batch.delete(d.ref);
      await batch.commit();
    },
    async touchLastUsed(uid, tokenId, now) {
      await tokens(uid)
        .doc(tokenId)
        .update({ lastUsedAt: Timestamp.fromMillis(now) });
    },
    newId: () => randomUUID().replace(/-/g, ''),
  };
}
