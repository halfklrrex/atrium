import { dateKeysOf, itemIndexFields, type ItemIndexBoard } from '@atrium/shared';

/**
 * `onItemPeopleAssigned` also keeps the server-maintained index fields of an item
 * (`assigneeUids`, `nameTokens`; see `packages/shared/src/item-index.ts`) and, since P5d, `dateKeys`
 * (`"<columnId>:<YYYY-MM-DD>"` per date cell of a main item; a subitem gets `[]`). They are metadata, not an
 * edit: the write never touches `updatedAt` / `updatedBy`. The pure logic takes an injected store so
 * it can be unit-tested; `admin-item-index.ts` adapts the Admin SDK to it.
 *
 * - Returns early unless `name` or `values` changed, or the fields are missing (an item written
 *   before the index existed heals on its next write; `scripts/migrations/2026-11-backfill-item-index.mjs`
 *   covers the rest).
 * - The board is read only when `values` changed (or `assigneeUids` is missing). A rename alone
 *   keeps the stored `assigneeUids` and costs no read.
 * - Writes only when a field differs from what is stored, so a retried event and the retrigger caused
 *   by this very write both find nothing to do.
 */

export interface ItemIndexWrite {
  assigneeUids: string[];
  nameTokens: string[];
  dateKeys: string[];
}

export interface ItemIndexStore {
  /** `null` when the board no longer exists. */
  getBoard(boardId: string): Promise<ItemIndexBoard | null>;
  /**
   * Writes both fields with one update, and nothing else. `expectedUpdateTime` (the event's
   * document version) makes the adapter skip the write when the item changed meanwhile: that newer
   * write has its own event. Resolves `false` when nothing was written for that reason or because
   * the item is gone.
   */
  setItemIndex(
    boardId: string,
    itemId: string,
    fields: ItemIndexWrite,
    expectedUpdateTime?: unknown,
  ): Promise<boolean>;
}

export interface ItemIndexChange {
  boardId: string;
  itemId: string;
  /** `undefined` on create. */
  before?: { name?: unknown; values?: Record<string, unknown> };
  after: {
    name?: unknown;
    state?: string;
    parentItemId?: string | null;
    values?: Record<string, unknown>;
    assigneeUids?: unknown;
    nameTokens?: unknown;
    dateKeys?: unknown;
  };
  /** The `updateTime` of the document version this event carries. */
  updateTime?: unknown;
}

const sameList = (a: unknown, b: readonly string[]): boolean =>
  Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/**
 * Wraps a store so `getBoard` reads each board once: the trigger shares the single board read
 * between the index sync and the notifications.
 */
export function withSharedBoardRead<S extends { getBoard(boardId: string): Promise<unknown> }>(
  store: S,
): S {
  const cache = new Map<string, Promise<unknown>>();
  return {
    ...store,
    getBoard(boardId: string) {
      let read = cache.get(boardId);
      if (!read) {
        read = store.getBoard(boardId);
        cache.set(boardId, read);
      }
      return read;
    },
  } as S;
}

/** Recomputes and stores the item's index fields. Returns true when it wrote them. */
export async function syncItemIndexFields(
  store: ItemIndexStore,
  change: ItemIndexChange,
): Promise<boolean> {
  const { before, after } = change;
  if (after.state === 'deleted') return false;

  const nameChanged = !before || before.name !== after.name;
  const valuesChanged = !before || !sameJson(before.values, after.values);
  const missing =
    !Array.isArray(after.assigneeUids) ||
    !Array.isArray(after.nameTokens) ||
    !Array.isArray(after.dateKeys);
  if (!nameChanged && !valuesChanged && !missing) return false;

  // The assignees depend on `values` and on the board's columns. A column changed to People writes
  // its values through the Admin SDK, which fires this trigger with changed values.
  const needsBoard =
    valuesChanged || !Array.isArray(after.assigneeUids) || !Array.isArray(after.dateKeys);
  let fields: ItemIndexWrite;
  if (needsBoard) {
    const board = await store.getBoard(change.boardId);
    if (!board) return false;
    fields = {
      ...itemIndexFields(board, after),
      // Date columns of the main board only; recipes never address a subitem's dates.
      dateKeys: after.parentItemId != null ? [] : dateKeysOf(after.values, board.columns),
    };
  } else {
    fields = {
      ...itemIndexFields({ columns: [] }, after),
      assigneeUids: after.assigneeUids as string[],
      dateKeys: after.dateKeys as string[],
    };
  }

  if (
    sameList(after.assigneeUids, fields.assigneeUids) &&
    sameList(after.nameTokens, fields.nameTokens) &&
    sameList(after.dateKeys, fields.dateKeys)
  ) {
    return false;
  }
  return await store.setItemIndex(change.boardId, change.itemId, fields, change.updateTime);
}
