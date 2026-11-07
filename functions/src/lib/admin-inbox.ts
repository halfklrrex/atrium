import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { accountStatusFromClaims } from '@atrium/shared';
import { adminAccountAuth } from './admin-account';
import { adminNotificationStore } from './admin-notifications';
import type { InboxAuth, InboxStore, InboxTx, LimitsData, ThreadData } from './inbox';

/** Admin SDK adapter for the Inbox logic. Every access goes through the `Firestore` from `db()`. */

/** Dates in, Timestamps out; everything else is stored as is. */
function toStored(data: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value instanceof Date ? Timestamp.fromDate(value) : value;
  }
  return out;
}

/** Timestamps in, Dates out. */
function fromStored<T>(data: FirebaseFirestore.DocumentData): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value instanceof Timestamp ? value.toDate() : value;
  }
  return out as T;
}

export function adminInboxTx(firestore: Firestore, tx: Transaction): InboxTx {
  const thread = (id: string) => firestore.collection('inbox').doc(id);
  const message = (threadId: string, id: string) => thread(threadId).collection('messages').doc(id);
  const limits = (uid: string) => firestore.collection('inboxLimits').doc(uid);
  const audit = (threadId: string, id: string) =>
    firestore.collection('inboxAudit').doc(threadId).collection('entries').doc(id);

  return {
    async getThread(threadId) {
      const snap = await tx.get(thread(threadId));
      return snap.exists ? fromStored<ThreadData>(snap.data()!) : null;
    },
    async getMessage(threadId, messageId) {
      const snap = await tx.get(message(threadId, messageId));
      if (!snap.exists) return null;
      const role: unknown = snap.get('authorRole');
      const uid: unknown = snap.get('authorUid');
      return {
        authorRole: role === 'admin' ? 'admin' : 'sender',
        authorUid: typeof uid === 'string' ? uid : null,
      };
    },
    async getLimits(uid) {
      const snap = await tx.get(limits(uid));
      return snap.exists ? fromStored<LimitsData>(snap.data()!) : null;
    },
    async findSenderThreads({ senderUid, kind, statuses, limit }) {
      const snap = await tx.get(
        firestore
          .collection('inbox')
          .where('senderUid', '==', senderUid)
          .where('kind', '==', kind)
          .where('status', 'in', [...statuses])
          .limit(limit),
      );
      return snap.docs.map((d) => ({ id: d.id }));
    },
    createThread: (threadId, data) => void tx.create(thread(threadId), toStored(data)),
    updateThread: (threadId, patch) => void tx.update(thread(threadId), toStored(patch)),
    createMessage: (threadId, id, data) => void tx.create(message(threadId, id), toStored(data)),
    setLimits: (uid, data) => void tx.set(limits(uid), toStored(data)),
    createAudit: (threadId, id, data) => void tx.create(audit(threadId, id), toStored(data)),
  };
}

export function adminInboxStore(firestore: Firestore): InboxStore {
  const deleteBatch = async (
    collection: FirebaseFirestore.CollectionReference,
    limit: number,
  ): Promise<number> => {
    const snap = await collection.limit(limit).get();
    if (snap.empty) return 0;
    const batch = firestore.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    return snap.size;
  };
  return {
    transaction: (fn) => firestore.runTransaction((tx) => fn(adminInboxTx(firestore, tx))),
    async getThread(threadId) {
      const snap = await firestore.collection('inbox').doc(threadId).get();
      return snap.exists ? fromStored<ThreadData>(snap.data()!) : null;
    },
    deleteMessagesBatch: (threadId, limit) =>
      deleteBatch(firestore.collection('inbox').doc(threadId).collection('messages'), limit),
    deleteAuditBatch: (threadId, limit) =>
      deleteBatch(firestore.collection('inboxAudit').doc(threadId).collection('entries'), limit),
    async deleteNotifications(refs) {
      const batch = firestore.batch();
      for (const { uid, id } of refs) {
        batch.delete(firestore.collection('users').doc(uid).collection('notifications').doc(id));
      }
      await batch.commit();
    },
    async deleteNoteAndThread(threadId) {
      const batch = firestore.batch();
      batch.delete(firestore.collection('inboxNotes').doc(threadId));
      batch.delete(firestore.collection('inbox').doc(threadId));
      await batch.commit();
    },
    upsertNotification: (uid, id, data) =>
      adminNotificationStore(firestore).upsertNotification(uid, id, data),
  };
}

/** Admin uids and account status come from the Auth claims (the source of truth for `acct`). */
export function adminInboxAuth(): InboxAuth {
  const auth = adminAccountAuth();
  return {
    listAdminUids: () => auth.listAdminUids(),
    async getAccountStatus(uid) {
      const user = await auth.getUser(uid);
      return user ? accountStatusFromClaims(user.claims) : null;
    },
  };
}
