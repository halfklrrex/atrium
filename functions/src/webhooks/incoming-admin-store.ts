import { randomUUID } from 'node:crypto';
import type { AccountStatus, BoardRole, WorkspaceRole } from '@atrium/shared';
import { Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import type { IncomingHookRecord, IncomingHookStore } from './incoming-store';

/**
 * Adapts the Admin SDK (named database via `db()`) to `IncomingHookStore`. `createdAt` and
 * `lastUsedAt` are stored as Timestamps and read back as epoch milliseconds. The index collection
 * `incomingHookIndex` is keyed by the SHA-256 hex of the whole token; a query by `hookId` (a
 * single-field equality, no composite index) finds the documents to replace or delete.
 */

export const INCOMING_HOOKS = 'incomingHooks';
export const INCOMING_HOOK_INDEX = 'incomingHookIndex';

const TIME_KEYS = new Set(['createdAt', 'lastUsedAt']);

function toFirestore(doc: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    out[key] =
      TIME_KEYS.has(key) && typeof value === 'number' ? Timestamp.fromMillis(value) : value;
  }
  return out;
}

function fromFirestore(snap: DocumentSnapshot): IncomingHookRecord | null {
  const data = snap.data();
  if (!data) return null;
  const at = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : null);
  return {
    name: String(data.name ?? ''),
    enabled: data.enabled === true,
    createdBy: String(data.createdBy ?? ''),
    createdAt: at(data.createdAt) ?? 0,
    lastUsedAt: at(data.lastUsedAt),
    defaultGroupId: typeof data.defaultGroupId === 'string' ? data.defaultGroupId : null,
  };
}

export function adminIncomingHookStore(firestore: Firestore): IncomingHookStore {
  const boards = firestore.collection('boards');
  const hooks = (boardId: string) => boards.doc(boardId).collection(INCOMING_HOOKS);
  const index = firestore.collection(INCOMING_HOOK_INDEX);

  return {
    newId: () => randomUUID().replace(/-/g, '').slice(0, 20),

    async getBoard(boardId) {
      const board = await boards.doc(boardId).get();
      if (!board.exists) return null;
      const workspaceId = String(board.get('workspaceId') ?? '');
      const ws = workspaceId
        ? await firestore.collection('workspaces').doc(workspaceId).get()
        : null;
      const groups = board.get('groups') as Array<{ id?: unknown }> | undefined;
      return {
        board: {
          workspaceId,
          kind: board.get('kind'),
          access: (board.get('access') as Record<string, BoardRole> | undefined) ?? {},
        },
        roles: ws?.exists
          ? ((ws.get('roles') as Record<string, WorkspaceRole> | undefined) ?? {})
          : null,
        state: typeof board.get('state') === 'string' ? (board.get('state') as string) : null,
        groupIds: (groups ?? []).map((g) => String(g.id)),
      };
    },

    async getHook(boardId, hookId) {
      return fromFirestore(await hooks(boardId).doc(hookId).get());
    },

    async createHookIfRoom({ boardId, hookId, doc, hash, now, max }) {
      return await firestore.runTransaction(async (tx) => {
        const existing = await tx.get(hooks(boardId));
        if (existing.size >= max) return false;
        tx.create(hooks(boardId).doc(hookId), toFirestore(doc));
        tx.create(index.doc(hash), { boardId, hookId, createdAt: Timestamp.fromMillis(now) });
        return true;
      });
    },

    async updateHook(boardId, hookId, patch) {
      await hooks(boardId).doc(hookId).update(toFirestore(patch));
    },

    async replaceHash(boardId, hookId, hash, now) {
      await firestore.runTransaction(async (tx) => {
        const old = await tx.get(index.where('hookId', '==', hookId));
        for (const d of old.docs) tx.delete(d.ref);
        tx.set(index.doc(hash), { boardId, hookId, createdAt: Timestamp.fromMillis(now) });
      });
    },

    async deleteHook(boardId, hookId) {
      return await firestore.runTransaction(async (tx) => {
        const ref = hooks(boardId).doc(hookId);
        const snap = await tx.get(ref);
        const old = await tx.get(index.where('hookId', '==', hookId));
        for (const d of old.docs) tx.delete(d.ref);
        if (!snap.exists) return false;
        tx.delete(ref);
        return true;
      });
    },

    async getIndex(hash) {
      const snap = await index.doc(hash).get();
      const boardId: unknown = snap.get('boardId');
      const hookId: unknown = snap.get('hookId');
      return snap.exists && typeof boardId === 'string' && typeof hookId === 'string'
        ? { boardId, hookId }
        : null;
    },

    async getAccountStatus(uid) {
      const status: unknown = (await firestore.collection('users').doc(uid).get()).get(
        'accountStatus',
      );
      return status === 'pending' || status === 'approved' || status === 'blocked'
        ? (status as AccountStatus)
        : null;
    },

    async touchLastUsed(boardId, hookId, now) {
      await hooks(boardId)
        .doc(hookId)
        .update({ lastUsedAt: Timestamp.fromMillis(now) });
    },
  };
}
