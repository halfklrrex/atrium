/**
 * Item writes for the board table. Cell edits write field paths (`values.<columnId>`), never the
 * whole `values` map, so two people editing different cells of one item cannot clobber each other
 * (architecture section 5.5; P1b spec section 8).
 */
import type { EntityState } from '@atrium/shared';
import {
  FieldPath,
  arrayRemove,
  arrayUnion,
  deleteField,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { plainRefs } from './firestore';
import type { NewItemInput } from './seed-items';

/** Firestore allows 500 writes per batch; stay under it. */
export const BATCH_LIMIT = 400;

export function chunk<T>(list: readonly T[], size: number = BATCH_LIMIT): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The two audit fields every item update must carry (rules: `updatedBy`, `updatedAt`). */
const audit = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

export interface ItemMove {
  groupId: string;
  position: string;
}

export const itemWrites = {
  /** Create one item; returns its id. The id may be chosen by the caller. */
  async create(
    uid: string,
    boardId: string,
    input: NewItemInput & { id?: string },
  ): Promise<string> {
    const ref = input.id ? plainRefs.item(boardId, input.id) : plainRefs.newItem(boardId);
    await setDoc(ref, {
      name: input.name,
      groupId: input.groupId,
      position: input.position,
      parentItemId: input.parentItemId ?? null,
      values: input.values ?? {},
      state: 'active',
      deletedAt: null,
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
    return ref.id;
  },

  /** Create many items in batches of at most `BATCH_LIMIT`; returns the new ids in order. */
  async createMany(
    uid: string,
    boardId: string,
    inputs: readonly (NewItemInput & { id?: string })[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const part of chunk(inputs)) {
      const batch = writeBatch(db);
      for (const input of part) {
        const ref = input.id ? plainRefs.item(boardId, input.id) : plainRefs.newItem(boardId);
        ids.push(ref.id);
        batch.set(ref, {
          name: input.name,
          groupId: input.groupId,
          position: input.position,
          parentItemId: input.parentItemId ?? null,
          values: input.values ?? {},
          state: 'active',
          deletedAt: null,
          createdAt: serverTimestamp(),
          createdBy: uid,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        });
      }
      await batch.commit();
      onProgress?.(ids.length, inputs.length);
    }
    return ids;
  },

  async rename(uid: string, boardId: string, itemId: string, name: string): Promise<void> {
    await updateDoc(plainRefs.item(boardId, itemId), { name, ...audit(uid) });
  },

  /** Set (or with `null`, clear) the rich-text description: one field-path write plus audit fields. */
  async setDescription(
    uid: string,
    boardId: string,
    itemId: string,
    description: { doc: Record<string, unknown>; text: string } | null,
  ): Promise<void> {
    await updateDoc(plainRefs.item(boardId, itemId), { description, ...audit(uid) });
  },

  /** Set (or with `null`, clear) one cell: a field-path write that leaves the other cells alone. */
  async setValue(
    uid: string,
    boardId: string,
    itemId: string,
    columnId: string,
    value: unknown,
  ): Promise<void> {
    await updateDoc(
      plainRefs.item(boardId, itemId),
      new FieldPath('values', columnId),
      value === null || value === undefined ? deleteField() : value,
      'updatedAt',
      serverTimestamp(),
      'updatedBy',
      uid,
    );
  },

  /**
   * Toggle a vote atomically using `arrayUnion` or `arrayRemove` on `values.<columnId>.votersIds`.
   * This prevents concurrent votes from clobbering each other.
   */
  async toggleVote(
    uid: string,
    boardId: string,
    itemId: string,
    columnId: string,
    hasVoted: boolean,
  ): Promise<void> {
    await updateDoc(
      plainRefs.item(boardId, itemId),
      new FieldPath('values', columnId, 'votersIds'),
      hasVoted ? arrayRemove(uid) : arrayUnion(uid),
      'updatedAt',
      serverTimestamp(),
      'updatedBy',
      uid,
    );
  },

  async move(uid: string, boardId: string, itemId: string, move: ItemMove): Promise<void> {
    await updateDoc(plainRefs.item(boardId, itemId), { ...move, ...audit(uid) });
  },

  /** Move many items at once (batched), e.g. "Move to group" for a selection. */
  async moveMany(
    uid: string,
    boardId: string,
    moves: readonly (ItemMove & { id: string })[],
  ): Promise<void> {
    for (const part of chunk(moves)) {
      const batch = writeBatch(db);
      for (const { id, ...move } of part) {
        batch.update(plainRefs.item(boardId, id), { ...move, ...audit(uid) });
      }
      await batch.commit();
    }
  },

  /** Archive, soft-delete or restore items (batched). Deleting stamps `deletedAt`. */
  async setState(
    uid: string,
    boardId: string,
    itemIds: readonly string[],
    state: EntityState,
  ): Promise<void> {
    for (const part of chunk(itemIds)) {
      const batch = writeBatch(db);
      for (const id of part) {
        batch.update(plainRefs.item(boardId, id), {
          state,
          deletedAt: state === 'deleted' ? serverTimestamp() : null,
          ...audit(uid),
        });
      }
      await batch.commit();
    }
  },

  /** Remove `values.<columnId>` from items (when a column is deleted). Batched. */
  async clearColumn(
    uid: string,
    boardId: string,
    itemIds: readonly string[],
    columnId: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    let done = 0;
    for (const part of chunk(itemIds)) {
      const batch = writeBatch(db);
      for (const id of part) {
        batch.update(
          plainRefs.item(boardId, id),
          new FieldPath('values', columnId),
          deleteField(),
          'updatedAt',
          serverTimestamp(),
          'updatedBy',
          uid,
        );
      }
      await batch.commit();
      done += part.length;
      onProgress?.(done, itemIds.length);
    }
  },

  /** Copy one column's values into another column (duplicate column with values). Batched. */
  async copyColumn(
    uid: string,
    boardId: string,
    cells: readonly { id: string; value: unknown }[],
    toColumnId: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    let done = 0;
    for (const part of chunk(cells)) {
      const batch = writeBatch(db);
      for (const { id, value } of part) {
        batch.update(
          plainRefs.item(boardId, id),
          new FieldPath('values', toColumnId),
          value,
          'updatedAt',
          serverTimestamp(),
          'updatedBy',
          uid,
        );
      }
      await batch.commit();
      done += part.length;
      onProgress?.(done, cells.length);
    }
  },
};
