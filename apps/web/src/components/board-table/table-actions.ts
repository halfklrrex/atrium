/**
 * Everything the board table can change, as plain async functions: each one runs the write, turns a
 * failure into a toast, and offers Undo where the spec asks for it. Cell edits are optimistic for
 * free: the Firestore SDK applies a write to the local cache at once and rolls it back when the
 * server rejects it, so a failed edit reverts on screen and shows the error toast from here.
 */
import {
  columnRegistry,
  defaultSubitemColumns,
  isSubitem,
  type BoardRole,
  type BoardWithColumnLocks,
  type ColumnDef,
  type EntityState,
  type GroupDef,
} from '@atrium/shared';
import {
  itemWrites,
  updateBoardStructure,
  writes,
  type BoardStructureState,
  type ItemDoc,
  type ItemMove,
  type NewItemInput,
  type StructurePatch,
} from '../../data';
import { newSlugId } from '../../lib/ids';
import {
  comparePositions,
  positionAfterAll,
  positionBeforeAll,
  positionBetween,
} from '../../lib/positions';
import { nextGroupColor } from '../../theme/palette';
import { describeError } from '../boards/board-actions';
import { showToast } from '../toast-store';
import {
  isClientReadOnlyType,
  validateCellWrite,
  withoutUnwritableValues,
  type ColumnLockContext,
} from './derived';
import { defaultColumnTitle, duplicateColumnTitle } from './column-naming';
import { appendPositions, dropPosition, positionsAfter } from './move-math';
import { clampWidth, withSubitemIds, type ColumnView } from './table-model';
import { useTableStore } from './table-store';

export interface TableCtx {
  boardId: string;
  uid: string;
  /**
   * Every column def of the table the action works on: cell writes are validated against them
   * (derived, settings). In the `'subitems'` scope these are the board's subitem columns.
   */
  columns: readonly ColumnDef[];
  /**
   * Which column list structure writes (add, rename, resize, delete a column) change: the board's
   * `columns` (when unset) or its `subitemColumns`.
   */
  scope?: 'columns' | 'subitems';
  /** The board's subitem column defs, to validate and copy subitem values (cascades). */
  subitemColumns?: readonly ColumnDef[];
  /** The board (for `columnLocks` checks). */
  board?: BoardWithColumnLocks | null;
  /** The caller's effective board role (`'owner'` can edit locked columns and manage locks). */
  boardRole?: BoardRole | null;
  /** Live read of the board's active items (parents and subitems), so cascades find subitems. */
  getItems?: () => readonly ItemDoc[];
  /** Live read of the board's groups, so a new group can be shown before its write returns. */
  getGroups?: () => readonly GroupDef[];
}

const lockCtxOf = (ctx: TableCtx): ColumnLockContext | undefined =>
  ctx.board !== undefined || ctx.boardRole !== undefined
    ? { board: ctx.board, boardRole: ctx.boardRole }
    : undefined;

/**
 * A new column id that no column uses in EITHER list: `derivedColumnIds`, `serverManagedColumnIds`
 * and column locks are flat id lists over `columns` and `subitemColumns` together.
 */
export function freshColumnId(
  state: Pick<BoardStructureState, 'columns' | 'subitemColumns'>,
): string {
  const taken = new Set([...state.columns, ...state.subitemColumns].map((c) => c.id));
  let id = newSlugId();
  while (taken.has(id)) id = newSlugId();
  return id;
}

const subitemsOf = (ctx: TableCtx, parentId: string): ItemDoc[] =>
  (ctx.getItems?.() ?? []).filter((i) => i.parentItemId === parentId);

type ColumnsKey = 'columns' | 'subitemColumns';
const columnsKey = (ctx: TableCtx): ColumnsKey =>
  ctx.scope === 'subitems' ? 'subitemColumns' : 'columns';
/** The column list a column action works on, and the patch that writes it back. */
const columnsOf = (ctx: TableCtx, state: BoardStructureState): ColumnDef[] =>
  state[columnsKey(ctx)];
const columnsPatch = (ctx: TableCtx, columns: ColumnDef[]): StructurePatch =>
  ({ [columnsKey(ctx)]: columns }) as StructurePatch;

async function attempt(task: () => Promise<unknown>, failure: string): Promise<boolean> {
  try {
    await task();
    return true;
  } catch (error) {
    console.error(failure, error);
    showToast(describeError(error, failure), { type: 'negative' });
    return false;
  }
}

/** Firestore rejects `undefined` anywhere in a document: round-trip through JSON to drop it. */
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Where a new group goes. */
export type GroupPlacement = 'top' | 'bottom' | { above: string } | { below: string };

function groupPosition(groups: readonly GroupDef[], where: GroupPlacement): string {
  const sorted = [...groups].sort(comparePositions);
  if (where === 'top') return positionBeforeAll(sorted);
  if (where === 'bottom') return positionAfterAll(sorted);
  const id = 'above' in where ? where.above : where.below;
  const at = sorted.findIndex((g) => g.id === id);
  if (at === -1) return positionAfterAll(sorted);
  return 'above' in where
    ? positionBetween(sorted[at - 1]?.position ?? null, sorted[at]!.position)
    : positionBetween(sorted[at]!.position, sorted[at + 1]?.position ?? null);
}

/** A copy of subitem `sub` under `parentId`, minus the values clients cannot write. */
function subitemCopy(
  ctx: TableCtx,
  sub: ItemDoc,
  parentId: string,
  groupId: string,
  position: string,
  name: string,
): NewItemInput {
  return {
    name,
    groupId,
    position,
    parentItemId: parentId,
    values: clean(withoutUnwritableValues(sub.values, ctx.subitemColumns ?? [], lockCtxOf(ctx))),
  };
}

export const tableActions = {
  // ---------------------------------------------------------------- items

  /** Create an item; returns its id, or `null` when the write failed. */
  async addItem(
    ctx: TableCtx,
    input: { groupId: string; position: string; name?: string; values?: Record<string, unknown> },
  ): Promise<string | null> {
    try {
      return await itemWrites.create(ctx.uid, ctx.boardId, {
        name: input.name?.trim() || 'New item',
        groupId: input.groupId,
        position: input.position,
        ...(input.values ? { values: input.values } : {}),
      });
    } catch (error) {
      console.error('Could not add the item', error);
      showToast(describeError(error, 'Could not add the item.'), { type: 'negative' });
      return null;
    }
  },

  /**
   * Create a subitem of `parent` (same group, next to its siblings). The board's first subitem also
   * writes the default subitem columns, in a board transaction before the item. Returns its id or
   * `null` when a write failed.
   */
  async addSubitem(
    ctx: TableCtx,
    parent: Pick<ItemDoc, 'id' | 'groupId'>,
    input: { position: string; name?: string },
  ): Promise<string | null> {
    try {
      if (ctx.subitemColumns?.length === 0 && !(ctx.getItems?.() ?? []).some(isSubitem)) {
        await updateBoardStructure(ctx.boardId, ({ columns, subitemColumns }) =>
          subitemColumns.length > 0
            ? null
            : { subitemColumns: defaultSubitemColumns(columns.map((c) => c.id)) },
        );
      }
      return await itemWrites.create(ctx.uid, ctx.boardId, {
        name: input.name?.trim() || 'New subitem',
        groupId: parent.groupId,
        position: input.position,
        parentItemId: parent.id,
      });
    } catch (error) {
      console.error('Could not add the subitem', error);
      showToast(describeError(error, 'Could not add the subitem.'), { type: 'negative' });
      return null;
    }
  },

  /** Toggle a vote atomically via `itemWrites.toggleVote`. */
  async toggleVote(
    ctx: TableCtx,
    itemId: string,
    columnId: string,
    hasVoted: boolean,
  ): Promise<boolean> {
    return attempt(
      () => itemWrites.toggleVote(ctx.uid, ctx.boardId, itemId, columnId, hasVoted),
      'Could not save the change.',
    );
  },

  /**
   * Validate, then write one cell. A refused value (derived, server-managed or locked column, wrong shape, settings rule) is
   * never sent: its message goes to an error toast instead. Resolves to whether the cell was written.
   */
  async setCell(
    ctx: TableCtx,
    itemId: string,
    columnId: string,
    value: unknown,
    item?: ItemDoc,
  ): Promise<boolean> {
    const check = validateCellWrite(
      ctx.boardId,
      ctx.columns,
      columnId,
      value,
      item,
      lockCtxOf(ctx),
    );
    if (!check.ok) {
      showToast(check.message, { type: 'negative' });
      return false;
    }

    const col = ctx.columns.find((c) => c.id === columnId);
    if (col?.type === 'vote') {
      if (value === null || value === undefined) {
        return attempt(
          () => itemWrites.setValue(ctx.uid, ctx.boardId, itemId, columnId, null),
          'Could not save the change.',
        );
      }
      const requestedInVoters = Boolean(
        (value as { votersIds?: string[] }).votersIds?.includes(ctx.uid),
      );
      return tableActions.toggleVote(ctx, itemId, columnId, !requestedInVoters);
    }

    return attempt(
      () => itemWrites.setValue(ctx.uid, ctx.boardId, itemId, columnId, value),
      'Could not save the change.',
    );
  },

  /**
   * Validate, then write one cell and the item's new `position` in a single document write (a
   * Kanban drop into another lane: new status, new place). Resolves to whether it was written.
   */
  async setCellAndMove(
    ctx: TableCtx,
    itemId: string,
    columnId: string,
    value: unknown,
    position: string,
    item?: ItemDoc,
  ): Promise<boolean> {
    const check = validateCellWrite(
      ctx.boardId,
      ctx.columns,
      columnId,
      value,
      item,
      lockCtxOf(ctx),
    );
    if (!check.ok) {
      showToast(check.message, { type: 'negative' });
      return false;
    }
    return attempt(
      () => itemWrites.setValueAndMove(ctx.uid, ctx.boardId, itemId, columnId, value, position),
      'Could not move the card.',
    );
  },

  async renameItem(ctx: TableCtx, itemId: string, name: string): Promise<void> {
    await attempt(
      () => itemWrites.rename(ctx.uid, ctx.boardId, itemId, name),
      'Could not rename the item.',
    );
  },

  /** Move an item. Moving a parent to another group takes its subitems along, in the same batch. */
  async moveItem(
    ctx: TableCtx,
    itemId: string,
    move: ItemMove,
    current?: Pick<ItemDoc, 'groupId'>,
  ): Promise<void> {
    const subs = current && current.groupId === move.groupId ? [] : subitemsOf(ctx, itemId);
    await attempt(
      () =>
        subs.length === 0
          ? itemWrites.move(ctx.uid, ctx.boardId, itemId, move)
          : itemWrites.moveMany(ctx.uid, ctx.boardId, [
              { id: itemId, ...move },
              ...subs.map((s) => ({ id: s.id, groupId: move.groupId, position: s.position })),
            ]),
      'Could not move the item.',
    );
  },

  /**
   * Copy items next to their originals ("Name (copy)"), values included. A copied item brings its
   * subitems with it (new parent id, same order); a copied subitem lands after its siblings.
   */
  async duplicateItems(
    ctx: TableCtx,
    items: readonly ItemDoc[],
    allInGroup: (groupId: string) => readonly ItemDoc[],
  ): Promise<void> {
    const inputs: (NewItemInput & { id?: string })[] = [];
    const picked = new Set(items.map((i) => i.id));
    const tops = items.filter((i) => !isSubitem(i));
    const byGroup = new Map<string, ItemDoc[]>();
    for (const item of tops)
      byGroup.set(item.groupId, [...(byGroup.get(item.groupId) ?? []), item]);
    for (const [groupId, group] of byGroup) {
      const ordered = [...group].sort(comparePositions);
      const keys = positionsAfter(
        allInGroup(groupId),
        ordered.map((i) => i.id),
      );
      ordered.forEach((item, i) => {
        const id = newSlugId(20);
        inputs.push({
          id,
          name: `${item.name} (copy)`.slice(0, 500),
          groupId,
          position: keys[i]!,
          values: clean(withoutUnwritableValues(item.values, ctx.columns, lockCtxOf(ctx))),
        });
        for (const sub of subitemsOf(ctx, item.id).sort(comparePositions)) {
          inputs.push(subitemCopy(ctx, sub, id, groupId, sub.position, sub.name));
        }
      });
    }
    // A subitem picked on its own is copied after its siblings (unless its parent was copied too).
    const subsByParent = new Map<string, ItemDoc[]>();
    for (const item of items) {
      if (!isSubitem(item) || picked.has(item.parentItemId!)) continue;
      subsByParent.set(item.parentItemId!, [...(subsByParent.get(item.parentItemId!) ?? []), item]);
    }
    for (const [parentId, subs] of subsByParent) {
      const ordered = [...subs].sort(comparePositions);
      const keys = positionsAfter(
        subitemsOf(ctx, parentId),
        ordered.map((s) => s.id),
      );
      ordered.forEach((sub, i) => {
        inputs.push(
          subitemCopy(
            ctx,
            sub,
            parentId,
            sub.groupId,
            keys[i]!,
            `${sub.name} (copy)`.slice(0, 500),
          ),
        );
      });
    }
    const ok = await attempt(
      () => itemWrites.createMany(ctx.uid, ctx.boardId, inputs),
      'Could not duplicate the items.',
    );
    if (ok) {
      showToast(items.length === 1 ? 'Item duplicated.' : `${items.length} items duplicated.`, {
        type: 'positive',
      });
    }
  },

  /** Archive or delete items (soft), with an Undo toast. */
  async retireItems(
    ctx: TableCtx,
    ids: readonly string[],
    state: Extract<EntityState, 'archived' | 'deleted'>,
  ): Promise<boolean> {
    if (ids.length === 0) return true;
    // Subitems follow their parent into the archive or the trash, and come back with it on Undo.
    const withSubs = withSubitemIds(ids, ctx.getItems?.() ?? []);
    const ok = await attempt(
      () => itemWrites.setState(ctx.uid, ctx.boardId, withSubs, state),
      state === 'archived' ? 'Could not archive the items.' : 'Could not delete the items.',
    );
    if (!ok) return false;
    const noun = ids.length === 1 ? 'Item' : `${ids.length} items`;
    showToast(`${noun} ${state === 'archived' ? 'archived' : 'deleted'}.`, {
      action: {
        label: 'Undo',
        onClick: () => {
          void attempt(
            () => itemWrites.setState(ctx.uid, ctx.boardId, withSubs, 'active'),
            'Could not restore the items.',
          );
        },
      },
    });
    return true;
  },

  /** Move items to the end of another group. */
  async moveItemsToGroup(
    ctx: TableCtx,
    items: readonly ItemDoc[],
    targetGroupId: string,
    targetItems: readonly ItemDoc[],
  ): Promise<void> {
    // Subitems cannot leave their parent's group on their own: only top-level items move.
    const moving = items
      .filter((i) => i.groupId !== targetGroupId && !isSubitem(i))
      .sort(comparePositions);
    if (moving.length === 0) return;
    const keys = appendPositions(targetItems, moving.length);
    await attempt(
      () =>
        itemWrites.moveMany(ctx.uid, ctx.boardId, [
          ...moving.map((item, i) => ({ id: item.id, groupId: targetGroupId, position: keys[i]! })),
          // Subitems keep their order and follow their parent into the group.
          ...moving.flatMap((item) =>
            subitemsOf(ctx, item.id).map((s) => ({
              id: s.id,
              groupId: targetGroupId,
              position: s.position,
            })),
          ),
        ]),
      'Could not move the items.',
    );
  },

  // --------------------------------------------------------------- groups

  /** Add a group; returns its id or `null`. */
  async addGroup(ctx: TableCtx, where: GroupPlacement, title?: string): Promise<string | null> {
    const id = newSlugId();
    const name = title ?? 'New Group';
    // The structure write is a transaction (a server round trip, no local latency compensation),
    // so show the group straight away from the groups we know; the board snapshot takes over.
    const known = ctx.getGroups?.() ?? [];
    const store = useTableStore.getState();
    store.addPendingGroup({
      id,
      title: name,
      color: nextGroupColor(known.map((g) => g.color)),
      position: groupPosition(known, where),
    });
    // A group added from the group controls opens its title for typing, as monday does.
    if (title === undefined) store.setRenamingGroup(id);
    const ok = await attempt(
      () =>
        updateBoardStructure(ctx.boardId, ({ groups }) => ({
          groups: [
            ...groups,
            {
              id,
              title: name,
              color: nextGroupColor(groups.map((g) => g.color)),
              position: groupPosition(groups, where),
            },
          ],
        })),
      'Could not add the group.',
    );
    if (!ok) useTableStore.getState().removePendingGroup(id);
    return ok ? id : null;
  },

  async updateGroup(
    ctx: TableCtx,
    groupId: string,
    patch: Partial<Pick<GroupDef, 'title' | 'color' | 'position'>>,
  ): Promise<void> {
    await attempt(
      () =>
        updateBoardStructure(ctx.boardId, ({ groups }) =>
          groups.some((g) => g.id === groupId)
            ? { groups: groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) }
            : null,
        ),
      'Could not update the group.',
    );
  },

  /** Move a group to the top or the bottom, or to `index` among the other groups. */
  async moveGroup(ctx: TableCtx, groupId: string, to: 'top' | 'bottom' | number): Promise<void> {
    await attempt(
      () =>
        updateBoardStructure(ctx.boardId, ({ groups }) => {
          if (!groups.some((g) => g.id === groupId)) return null;
          const others = groups.filter((g) => g.id !== groupId);
          const position =
            to === 'top'
              ? positionBeforeAll(others)
              : to === 'bottom'
                ? positionAfterAll(others)
                : dropPosition(groups, groupId, to);
          return { groups: groups.map((g) => (g.id === groupId ? { ...g, position } : g)) };
        }),
      'Could not move the group.',
    );
  },

  /** Copy a group with all its items (in chunks). Returns the new group id. */
  async duplicateGroup(
    ctx: TableCtx,
    group: GroupDef,
    items: readonly ItemDoc[],
  ): Promise<string | null> {
    const id = newSlugId();
    const created = await attempt(
      () =>
        updateBoardStructure(ctx.boardId, ({ groups }) => ({
          groups: [
            ...groups,
            {
              id,
              title: `Duplicate of ${group.title}`.slice(0, 120),
              color: group.color,
              position: groupPosition(groups, { below: group.id }),
            },
          ],
        })),
      'Could not duplicate the group.',
    );
    if (!created) return null;
    if (items.length > 0) {
      const inputs: (NewItemInput & { id?: string })[] = items.flatMap((item) => {
        const newId = newSlugId(20);
        return [
          {
            id: newId,
            name: item.name,
            groupId: id,
            position: item.position,
            values: clean(withoutUnwritableValues(item.values, ctx.columns, lockCtxOf(ctx))),
          },
          ...subitemsOf(ctx, item.id).map((sub) =>
            subitemCopy(ctx, sub, newId, id, sub.position, sub.name),
          ),
        ];
      });
      const ok = await attempt(
        () => itemWrites.createMany(ctx.uid, ctx.boardId, inputs),
        'The group was copied, but not all of its items.',
      );
      if (!ok) return id;
    }
    showToast(`Group "${group.title}" duplicated.`, { type: 'positive' });
    return id;
  },

  /** Delete a group: its items are soft-deleted and the group leaves the board. Undo restores both. */
  async deleteGroup(ctx: TableCtx, group: GroupDef, items: readonly ItemDoc[]): Promise<boolean> {
    // Every subitem of the group's items goes to the trash with them (and comes back on Undo).
    const ids = withSubitemIds(
      items.map((i) => i.id),
      ctx.getItems?.() ?? [],
    );
    const ok = await attempt(async () => {
      if (ids.length > 0) await itemWrites.setState(ctx.uid, ctx.boardId, ids, 'deleted');
      await updateBoardStructure(ctx.boardId, ({ groups }) => ({
        groups: groups.filter((g) => g.id !== group.id),
      }));
    }, 'Could not delete the group.');
    if (!ok) return false;
    showToast(`Group "${group.title}" deleted.`, {
      action: {
        label: 'Undo',
        onClick: () => {
          void attempt(async () => {
            await updateBoardStructure(ctx.boardId, ({ groups }) =>
              groups.some((g) => g.id === group.id) ? null : { groups: [...groups, group] },
            );
            if (ids.length > 0) await itemWrites.setState(ctx.uid, ctx.boardId, ids, 'active');
          }, 'Could not restore the group.');
        },
      },
    });
    return true;
  },

  // -------------------------------------------------------------- columns

  /** Add a column of `type` (after `afterColumnId`, else at the end). Returns its id or `null`. */
  async addColumn(ctx: TableCtx, type: string, afterColumnId?: string): Promise<string | null> {
    let id = '';
    const ok = await attempt(
      () =>
        updateBoardStructure(ctx.boardId, (state) => {
          id = freshColumnId(state);
          const columns = columnsOf(ctx, state);
          const sorted = [...columns].sort(comparePositions);
          const at = afterColumnId ? sorted.findIndex((c) => c.id === afterColumnId) : -1;
          const position =
            at === -1
              ? positionAfterAll(sorted)
              : positionBetween(sorted[at]!.position, sorted[at + 1]?.position ?? null);
          const column: ColumnDef = {
            id,
            type,
            title: defaultColumnTitle(
              type,
              columns.map((c) => c.title),
            ),
            position,
            settings: clean(columnRegistry.defaultSettings(type)) as Record<string, unknown>,
          };
          return columnsPatch(ctx, [...columns, column]);
        }),
      'Could not add the column.',
    );
    return ok ? id : null;
  },

  async updateColumn(
    ctx: TableCtx,
    columnId: string,
    patch: Partial<Pick<ColumnDef, 'title' | 'settings' | 'width' | 'position'>>,
  ): Promise<void> {
    await attempt(
      () =>
        updateBoardStructure(ctx.boardId, (state) => {
          const columns = columnsOf(ctx, state);
          return columns.some((c) => c.id === columnId)
            ? columnsPatch(
                ctx,
                columns.map((c) => (c.id === columnId ? clean({ ...c, ...patch }) : c)),
              )
            : null;
        }),
      'Could not update the column.',
    );
  },

  async resizeColumn(ctx: TableCtx, columnId: string, width: number): Promise<void> {
    await tableActions.updateColumn(ctx, columnId, { width: clampWidth(width) });
  },

  /** Move a column so it ends up at `index` among the other columns. */
  async reorderColumn(ctx: TableCtx, columnId: string, index: number): Promise<void> {
    await attempt(
      () =>
        updateBoardStructure(ctx.boardId, (state) => {
          const columns = columnsOf(ctx, state);
          if (!columns.some((c) => c.id === columnId)) return null;
          const position = dropPosition(columns, columnId, index);
          return columnsPatch(
            ctx,
            columns.map((c) => (c.id === columnId ? { ...c, position } : c)),
          );
        }),
      'Could not move the column.',
    );
  },

  /** Lock or unlock a column on the board. Only board owners may do this (rules). */
  async toggleColumnLock(boardId: string, columnId: string, locked: boolean): Promise<boolean> {
    return attempt(
      () => writes.toggleColumnLock(boardId, columnId, locked),
      'Could not update column lock.',
    );
  },

  /** Remove a column and its values from every item (values in chunks). */
  async deleteColumn(
    ctx: TableCtx,
    column: ColumnDef,
    itemIds: readonly string[],
  ): Promise<boolean> {
    const removed = await attempt(
      () =>
        updateBoardStructure(ctx.boardId, (state) => {
          const patch = columnsPatch(
            ctx,
            columnsOf(ctx, state).filter((c) => c.id !== column.id),
          );
          if (ctx.boardRole === 'owner' && state.columnLocks?.includes(column.id)) {
            patch.columnLocks = state.columnLocks.filter((id) => id !== column.id);
          }
          return patch;
        }),
      'Could not delete the column.',
    );
    if (!removed) return false;
    // A derived column has no stored values to clean up, and the rules refuse client writes to
    // server-managed ones or to locked columns when the caller is not a board owner (their leftover
    // values are harmless and invisible without the column).
    if (
      !isClientReadOnlyType(column.type) &&
      !(ctx.boardRole !== 'owner' && ctx.board?.columnLocks?.includes(column.id))
    )
      await attempt(
        () => itemWrites.clearColumn(ctx.uid, ctx.boardId, itemIds, column.id),
        'The column was deleted, but some values could not be cleaned up.',
      );
    showToast(`Column "${column.title}" deleted.`);
    return true;
  },

  /** Copy a column, values included, next to the original. */
  async duplicateColumn(
    ctx: TableCtx,
    source: ColumnView,
    items: readonly ItemDoc[],
  ): Promise<string | null> {
    let id = '';
    const ok = await attempt(
      () =>
        updateBoardStructure(ctx.boardId, (state) => {
          id = freshColumnId(state);
          const columns = columnsOf(ctx, state);
          const sorted = [...columns].sort(comparePositions);
          const at = sorted.findIndex((c) => c.id === source.def.id);
          const position =
            at === -1
              ? positionAfterAll(sorted)
              : positionBetween(sorted[at]!.position, sorted[at + 1]?.position ?? null);
          const copy: ColumnDef = clean({
            ...source.def,
            id,
            title: duplicateColumnTitle(
              source.def.title,
              columns.map((c) => c.title),
            ),
            position,
          });
          return columnsPatch(ctx, [...columns, copy]);
        }),
      'Could not duplicate the column.',
    );
    if (!ok) return null;
    // A derived column stores nothing, and the rules refuse client writes to server-managed cells,
    // so there is nothing to copy.
    const cells = isClientReadOnlyType(source.def.type)
      ? []
      : items.flatMap((item) => {
          const value = item.values[source.def.id];
          return value === undefined || value === null
            ? []
            : [{ id: item.id, value: clean(value) }];
        });
    if (cells.length > 0) {
      showToast(`Copying ${cells.length} values…`);
      const copied = await attempt(
        () => itemWrites.copyColumn(ctx.uid, ctx.boardId, cells, id),
        'The column was duplicated, but not all of its values.',
      );
      if (!copied) return id;
    }
    showToast(`Column "${source.def.title}" duplicated.`, { type: 'positive' });
    return id;
  },
};
