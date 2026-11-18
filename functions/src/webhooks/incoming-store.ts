import type { AccountStatus } from '@atrium/shared';
import type { BoardAccessRecord } from './store';

/**
 * Storage seam for incoming webhooks (P8 PR 7a). The logic (`incoming.ts`, `api/hooks.ts`) talks to
 * this interface so it is unit tested with the in-memory fake; `incoming-admin-store.ts` adapts
 * Firestore (Timestamps there, epoch milliseconds here).
 */

/** `boards/{boardId}/incomingHooks/{id}`. Never holds the secret or its hash. */
export interface IncomingHookRecord {
  name: string;
  enabled: boolean;
  createdBy: string;
  createdAt: number;
  lastUsedAt: number | null;
  defaultGroupId: string | null;
}

/** `incomingHookIndex/{sha256hex}`. */
export interface IncomingHookIndexRecord {
  boardId: string;
  hookId: string;
}

export interface IncomingBoardRecord extends BoardAccessRecord {
  /** `active`, `archived` or `deleted`; `null` when the field is missing. */
  state: string | null;
  groupIds: string[];
}

export interface IncomingHookStore {
  newId(): string;
  getBoard(boardId: string): Promise<IncomingBoardRecord | null>;
  getHook(boardId: string, hookId: string): Promise<IncomingHookRecord | null>;
  /**
   * Creates the hook and its index document in one transaction unless the board already has `max`
   * hooks. Resolves false (nothing written) when it is full.
   */
  createHookIfRoom(args: {
    boardId: string;
    hookId: string;
    doc: IncomingHookRecord;
    hash: string;
    now: number;
    max: number;
  }): Promise<boolean>;
  updateHook(boardId: string, hookId: string, patch: Partial<IncomingHookRecord>): Promise<void>;
  /** Replaces the hook's index document(s) with one for `hash`: the old URL stops working at once. */
  replaceHash(boardId: string, hookId: string, hash: string, now: number): Promise<void>;
  /** Removes the hook and its index document(s). Resolves false when there was no such hook. */
  deleteHook(boardId: string, hookId: string): Promise<boolean>;
  getIndex(hash: string): Promise<IncomingHookIndexRecord | null>;
  /** `users/{uid}.accountStatus`, `null` when missing. */
  getAccountStatus(uid: string): Promise<AccountStatus | null>;
  touchLastUsed(boardId: string, hookId: string, now: number): Promise<void>;
}
