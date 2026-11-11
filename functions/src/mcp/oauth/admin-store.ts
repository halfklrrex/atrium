import { randomUUID } from 'node:crypto';
import type { AccountStatus } from '@atrium/shared';
import { Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import {
  MCP_AUDIT_DOC,
  MCP_AUDIT_ENTRIES,
  MCP_AUTH_REQUESTS,
  MCP_CLIENTS,
  MCP_GRANTS,
  MCP_TOKENS,
} from './constants';
import type {
  McpAuthRequestDoc,
  McpClientDoc,
  McpGrantDoc,
  McpStore,
  McpTokenDoc,
  McpTx,
} from './store';

/**
 * Adapts the Admin SDK (named database via `db()`) to the OAuth store. Every `*At` field is stored
 * as a Firestore `Timestamp` (the TTL policies in OPS4 section 11 read `expiresAt`) and read back as
 * epoch milliseconds. Firestore batches at most 500 writes, so deletes are chunked.
 */

const DELETE_CHUNK = 400;

const TIME_KEYS = new Set([
  'createdAt',
  'lastUsedAt',
  'lastRefreshAt',
  'revokedAt',
  'expiresAt',
  'usedAt',
  'at',
]);

/** Numbers in time fields become Timestamps; everything else is copied as is. */
function toFirestore<T extends object>(doc: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined) continue;
    out[key] =
      TIME_KEYS.has(key) && typeof value === 'number' ? Timestamp.fromMillis(value) : value;
  }
  return out;
}

/** Timestamps in time fields become milliseconds. */
function fromFirestore<T>(snap: DocumentSnapshot): T | null {
  const data = snap.data();
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = TIME_KEYS.has(key) && value instanceof Timestamp ? value.toMillis() : value;
  }
  return out as T;
}

const accountStatusOf = (snap: DocumentSnapshot): AccountStatus | null => {
  const status: unknown = snap.get('accountStatus');
  return status === 'pending' || status === 'approved' || status === 'blocked' ? status : null;
};

export function adminMcpStore(firestore: Firestore): McpStore {
  const clients = firestore.collection(MCP_CLIENTS);
  const requests = firestore.collection(MCP_AUTH_REQUESTS);
  const tokens = firestore.collection(MCP_TOKENS);
  const users = firestore.collection('users');
  const grants = (uid: string) => users.doc(uid).collection(MCP_GRANTS);
  const audit = firestore.collection('system').doc(MCP_AUDIT_DOC).collection(MCP_AUDIT_ENTRIES);

  return {
    async getClient(clientId) {
      return fromFirestore<McpClientDoc>(await clients.doc(clientId).get());
    },
    async setClient(doc) {
      await clients.doc(doc.clientId).set(toFirestore(doc));
    },
    async touchClient(clientId, lastUsedAt, expiresAt) {
      await clients.doc(clientId).update(toFirestore({ lastUsedAt, expiresAt }));
    },
    async createAuthRequest(requestId, doc) {
      await requests.doc(requestId).create(toFirestore(doc));
    },
    async getAuthRequest(requestId) {
      return fromFirestore<McpAuthRequestDoc>(await requests.doc(requestId).get());
    },
    async getToken(hash) {
      return fromFirestore<McpTokenDoc>(await tokens.doc(hash).get());
    },
    async getAccountStatus(uid) {
      return accountStatusOf(await users.doc(uid).get());
    },
    async getGrant(uid, grantId) {
      return fromFirestore<McpGrantDoc>(await grants(uid).doc(grantId).get());
    },
    async listActiveGrants(uid) {
      const snap = await grants(uid).where('revokedAt', '==', null).get();
      return snap.docs.map((d) => ({
        uid,
        grantId: d.id,
        doc: fromFirestore<McpGrantDoc>(d)!,
      }));
    },
    async listGrantTokenHashes(grantId) {
      const snap = await tokens.where('grantId', '==', grantId).select().get();
      return snap.docs.map((d) => d.id);
    },
    async deleteTokens(hashes) {
      for (let i = 0; i < hashes.length; i += DELETE_CHUNK) {
        const batch = firestore.batch();
        for (const hash of hashes.slice(i, i + DELETE_CHUNK)) batch.delete(tokens.doc(hash));
        await batch.commit();
      }
    },
    async updateGrant(uid, grantId, patch) {
      await grants(uid).doc(grantId).update(toFirestore(patch));
    },
    async appendAudit(entry) {
      await audit.add(toFirestore(entry));
    },
    runTransaction(fn) {
      return firestore.runTransaction(async (tx) => {
        const view: McpTx = {
          async getAuthRequest(requestId) {
            return fromFirestore<McpAuthRequestDoc>(await tx.get(requests.doc(requestId)));
          },
          async getToken(hash) {
            return fromFirestore<McpTokenDoc>(await tx.get(tokens.doc(hash)));
          },
          async getGrant(uid, grantId) {
            return fromFirestore<McpGrantDoc>(await tx.get(grants(uid).doc(grantId)));
          },
          async getAccountStatus(uid) {
            return accountStatusOf(await tx.get(users.doc(uid)));
          },
          updateAuthRequest(requestId, patch) {
            tx.update(requests.doc(requestId), toFirestore(patch));
          },
          setToken(hash, doc) {
            tx.set(tokens.doc(hash), toFirestore(doc));
          },
          updateToken(hash, patch) {
            tx.update(tokens.doc(hash), toFirestore(patch));
          },
          setGrant(uid, grantId, doc) {
            tx.set(grants(uid).doc(grantId), toFirestore(doc));
          },
          updateGrant(uid, grantId, patch) {
            tx.update(grants(uid).doc(grantId), toFirestore(patch));
          },
        };
        return fn(view);
      });
    },
    newId: () => randomUUID().replace(/-/g, ''),
  };
}
