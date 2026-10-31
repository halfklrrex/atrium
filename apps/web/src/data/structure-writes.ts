/**
 * Board structure writes. `columns` and `groups` live inside the board document as arrays, so every
 * change replaces the array: read-modify-write inside a transaction so two people changing different
 * columns or groups cannot overwrite each other (P1b spec section 8).
 */
import type { ColumnDef, GroupDef } from '@atrium/shared';
import { runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { plainRefs } from './firestore';
import { keepServerColumnFields } from './server-column-fields';

export interface BoardStructureState {
  columns: ColumnDef[];
  /** Columns of the subitem tables (`board.subitemColumns`); `[]` until the first subitem. */
  subitemColumns: ColumnDef[];
  groups: GroupDef[];
  /** Ids of locked columns (`board.columnLocks`); `[]` when unset. */
  columnLocks?: string[];
}

/** What an updater returns: the arrays it changed (missing ones are left as they are). */
export type StructurePatch = Partial<BoardStructureState>;

/**
 * Apply `update` to the board's current columns and groups. The updater may be called more than
 * once (the transaction retries on contention), so it must be a pure function of its input.
 * Returning `null` aborts without writing.
 */
export async function updateBoardStructure(
  boardId: string,
  update: (current: BoardStructureState) => StructurePatch | null,
): Promise<BoardStructureState | null> {
  const ref = plainRefs.board(boardId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('This board no longer exists.');
    const data = snap.data();
    const current: BoardStructureState = {
      columns: (data.columns ?? []) as ColumnDef[],
      subitemColumns: (data.subitemColumns ?? []) as ColumnDef[],
      groups: (data.groups ?? []) as GroupDef[],
      columnLocks: (data.columnLocks ?? []) as string[],
    };
    const patch = update(current);
    if (!patch) return null;
    const safe: StructurePatch = { ...patch };
    if (patch.columns) safe.columns = keepServerColumnFields(patch.columns, current.columns);
    if (patch.subitemColumns) {
      safe.subitemColumns = keepServerColumnFields(patch.subitemColumns, current.subitemColumns);
    }
    tx.update(ref, { ...safe, updatedAt: serverTimestamp() });
    return { ...current, ...safe };
  });
}
