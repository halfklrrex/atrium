import type { AccountStatus } from '@atrium/shared';
import type {
  IncomingBoardRecord,
  IncomingHookIndexRecord,
  IncomingHookRecord,
  IncomingHookStore,
} from './incoming-store';

/** In-memory `IncomingHookStore` for unit tests. Same semantics as the Firestore adapter. */
export interface FakeIncomingHookStore extends IncomingHookStore {
  boards: Map<string, IncomingBoardRecord>;
  hooks: Map<string, IncomingHookRecord>;
  index: Map<string, IncomingHookIndexRecord>;
  accounts: Map<string, AccountStatus>;
}

const key = (boardId: string, hookId: string) => `${boardId}/${hookId}`;

export function fakeIncomingHookStore(): FakeIncomingHookStore {
  let seq = 0;
  const boards = new Map<string, IncomingBoardRecord>();
  const hooks = new Map<string, IncomingHookRecord>();
  const index = new Map<string, IncomingHookIndexRecord>();
  const accounts = new Map<string, AccountStatus>();
  const inBoard = (boardId: string) =>
    [...hooks.keys()].filter((k) => k.startsWith(`${boardId}/`)).length;
  const dropIndex = (hookId: string) => {
    for (const [hash, rec] of index) if (rec.hookId === hookId) index.delete(hash);
  };

  return {
    boards,
    hooks,
    index,
    accounts,
    newId: () => `hook${String(++seq).padStart(6, '0')}`,
    async getBoard(boardId) {
      return boards.get(boardId) ?? null;
    },
    async getHook(boardId, hookId) {
      const h = hooks.get(key(boardId, hookId));
      return h ? { ...h } : null;
    },
    async createHookIfRoom({ boardId, hookId, doc, hash, max }) {
      if (inBoard(boardId) >= max) return false;
      hooks.set(key(boardId, hookId), { ...doc });
      index.set(hash, { boardId, hookId });
      return true;
    },
    async updateHook(boardId, hookId, patch) {
      const k = key(boardId, hookId);
      const current = hooks.get(k);
      if (!current) throw new Error('NOT_FOUND');
      hooks.set(k, { ...current, ...patch });
    },
    async replaceHash(boardId, hookId, hash) {
      dropIndex(hookId);
      index.set(hash, { boardId, hookId });
    },
    async deleteHook(boardId, hookId) {
      dropIndex(hookId);
      return hooks.delete(key(boardId, hookId));
    },
    async getIndex(hash) {
      const r = index.get(hash);
      return r ? { ...r } : null;
    },
    async getAccountStatus(uid) {
      return accounts.get(uid) ?? null;
    },
    async touchLastUsed(boardId, hookId, now) {
      const k = key(boardId, hookId);
      const current = hooks.get(k);
      if (current) hooks.set(k, { ...current, lastUsedAt: now });
    },
  };
}
