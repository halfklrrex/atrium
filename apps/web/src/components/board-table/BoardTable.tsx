import { canEditBoard, columnRegistry, resolveBoardRole, type GroupDef } from '@atrium/shared';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Loader } from '@vibe/core';
import { Add } from '@vibe/icons';
import { useBoardFilter, useHiddenColumnIds } from '../board-filters';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useAuth } from '../../auth/auth-context';
import { useItems, usePresence, useWorkspace, type BoardDoc, type ItemDoc } from '../../data';
import { comparePositions, positionBeforeAll, positionBetween } from '../../lib/positions';
import { BatchBar } from './BatchBar';
import { BoardToolbar } from './BoardToolbar';
import { GroupBlock } from './GroupBlock';
import { ItemRowBody } from './ItemRow';
import { SubitemScope } from './SubitemBlock';
import { useItemViewStore } from '../item-view/item-view-store';
import { isClientReadOnlyType } from './derived';
import { dropPosition } from './move-math';
import { tableActions, type TableCtx } from './table-actions';
import { TableEnvContext, type TableEnv } from './table-env';
import { isArrowKey, isTypingTarget, moveActiveCell } from './table-keyboard';
import {
  DEFAULT_NAME_WIDTH,
  MIN_NAME_WIDTH,
  NAME_COLUMN,
  buildColumnViews,
  buildGroupModels,
  clampWidth,
  groupKey,
  gridTemplate,
  tableWidth,
  type GroupModel,
  type MovePatch,
} from './table-model';
import { useTablePrefs, useTableStore } from './table-store';
import { getColumnUi } from '../../columns/registry';
import styles from './table.module.css';
import { useDeepStable } from './useDeepStable';

const ADD_TRACK = 'var(--atrium-table-add-width)';

/** Pointer position decides first (rows and group bodies), the closest centre is the fallback. */
const collisionDetection: CollisionDetection = (args) => {
  const type = args.active.data.current?.type;
  const only = (kinds: readonly string[]) =>
    args.droppableContainers.filter((c) => kinds.includes(c.data.current?.type));
  if (type === 'subitem') {
    // A subitem can only be reordered among the subitems of its own parent.
    const parentId = args.active.data.current?.parentId;
    const siblings = only(['subitem']).filter((c) => c.data.current?.parentId === parentId);
    const hit = pointerWithin({ ...args, droppableContainers: siblings });
    return hit.length > 0 ? hit : closestCenter({ ...args, droppableContainers: siblings });
  }
  if (type === 'group') {
    return closestCenter({ ...args, droppableContainers: only(['group']) });
  }
  const within = pointerWithin({ ...args, droppableContainers: only(['item', 'group-drop']) });
  const row = within.filter(
    (c) => args.droppableContainers.find((d) => d.id === c.id)?.data.current?.type === 'item',
  );
  if (row.length > 0) return row;
  if (within.length > 0) return within;
  return closestCenter({ ...args, droppableContainers: only(['item']) });
};

export interface BoardTableProps {
  board: BoardDoc;
  userLookup?: (uid: string) => string | undefined;
}

/** The board table: toolbar, groups with their rows, and the floating batch bar. */
export function BoardTable({ board, userLookup: userLookupProp }: BoardTableProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: workspace } = useWorkspace(board.workspaceId);
  const canEdit = canEditBoard(resolveBoardRole(board, uid, workspace?.roles[uid]));
  const { data: items, loading, error } = useItems(board.id);
  const { viewers } = usePresence(board.id);

  const lookup = useCallback(
    (targetUid: string): string | undefined => {
      if (userLookupProp) {
        const custom = userLookupProp(targetUid);
        if (custom) return custom;
      }
      if (user && targetUid === user.uid) return user.displayName ?? user.email ?? 'You';
      const viewer = viewers.find((v) => v.uid === targetUid);
      if (viewer?.displayName) return viewer.displayName;
      return undefined;
    },
    [userLookupProp, user, viewers],
  );

  const boardId = board.id;
  useEffect(() => {
    useTableStore.getState().reset(boardId);
  }, [boardId]);

  // Structure arrays come from every board snapshot; keep the same objects while nothing changed.
  const columnDefs = useDeepStable(board.columns);
  const subitemDefs = useDeepStable(board.subitemColumns ?? []);
  const groupDefs = useDeepStable(board.groups);
  const allColumns = useMemo(() => buildColumnViews(columnDefs), [columnDefs]);
  // Hide: the columns this view does not show still filter, sort and group.
  const hiddenIds = useHiddenColumnIds(board.id);
  const columns = useMemo(
    () =>
      hiddenIds.length === 0 ? allColumns : allColumns.filter((c) => !hiddenIds.includes(c.def.id)),
    [allColumns, hiddenIds],
  );
  const subitemColumns = useMemo(() => buildColumnViews(subitemDefs), [subitemDefs]);
  // Groups just added here show at once; the board snapshot replaces them when it catches up.
  const pendingGroups = useTableStore((s) => s.pendingGroups);
  const groups = useMemo(
    () =>
      [...groupDefs, ...pendingGroups.filter((p) => !groupDefs.some((g) => g.id === p.id))].sort(
        (a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0),
      ),
    [groupDefs, pendingGroups],
  );
  useEffect(() => {
    const store = useTableStore.getState();
    for (const p of store.pendingGroups) {
      if (groupDefs.some((g) => g.id === p.id)) store.removePendingGroup(p.id);
    }
  }, [groupDefs]);

  // ---- Widths: the Item column is a per-user preference, the others live in the column defs.
  const savedNameWidth = useTablePrefs((s) => s.nameWidth[boardId]) ?? DEFAULT_NAME_WIDTH;
  const [live, setLive] = useState<Record<string, number>>({});
  // Forget a live width once the saved column caught up with it (state adjusted while rendering).
  const [seenColumns, setSeenColumns] = useState(columns);
  if (seenColumns !== columns) {
    setSeenColumns(columns);
    const next = { ...live };
    for (const column of columns) {
      if (next[column.def.id] === column.width) delete next[column.def.id];
    }
    if (Object.keys(next).length !== Object.keys(live).length) setLive(next);
  }
  const nameWidth = live[NAME_COLUMN] ?? savedNameWidth;
  const gridColumns = useMemo(
    () => columns.map((c) => (live[c.def.id] ? { ...c, width: live[c.def.id]! } : c)),
    [columns, live],
  );

  // ---- View state
  const { filterState } = useBoardFilter(board.id);
  const search = useDeferredValue(useTableStore((s) => s.search)).trim();
  const [patches, setPatches] = useState<Record<string, MovePatch>>({});
  const models = useMemo(
    () =>
      buildGroupModels({
        groups,
        items,
        columns: allColumns,
        subitemColumns,
        search,
        patches,
        filterState,
        userLookup: lookup,
      }),
    [groups, items, allColumns, subitemColumns, search, patches, filterState, lookup],
  );

  // Live reads for event handlers and menus, without re-rendering rows when data arrives.
  const modelsRef = useRef<GroupModel[]>(models);
  const itemsRef = useRef<ItemDoc[]>(items);
  useEffect(() => {
    modelsRef.current = models;
    itemsRef.current = items;
  });
  // The full item view steps through the rows shown here (after search, sort and filter).
  useEffect(() => {
    useItemViewStore.getState().setVisible(
      boardId,
      models.map((m) => ({ groupId: m.group.id, ids: m.items.map((i) => i.id) })),
    );
  }, [boardId, models]);
  const getModels = useCallback(() => modelsRef.current, []);
  const getItems = useCallback(() => itemsRef.current, []);
  const groupsRef = useRef<readonly GroupDef[]>(groups);
  useEffect(() => {
    groupsRef.current = groups;
  });
  const getGroups = useCallback(() => groupsRef.current, []);

  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const ctx = useMemo<TableCtx>(
    () => ({
      boardId,
      uid,
      columns: columnDefs,
      subitemColumns: subitemDefs,
      getItems,
      getGroups,
    }),
    [boardId, uid, columnDefs, subitemDefs, getItems, getGroups],
  );
  // The same context for the cells of a subitem (what the keyboard writes to).
  const subitemCtx = useMemo<TableCtx>(
    () => ({ ...ctx, columns: subitemDefs, scope: 'subitems' }),
    [ctx, subitemDefs],
  );

  const onResize = useCallback(
    (columnId: string, width: number, final: boolean) => {
      if (columnId === NAME_COLUMN) {
        const next = Math.max(MIN_NAME_WIDTH, Math.round(width));
        if (final) {
          useTablePrefs.getState().setNameWidth(boardId, next);
          setLive((c) => {
            const { [NAME_COLUMN]: _removed, ...rest } = c;
            return rest;
          });
        } else setLive((c) => ({ ...c, [NAME_COLUMN]: next }));
        return;
      }
      const next = clampWidth(width);
      setLive((c) => ({ ...c, [columnId]: next }));
      if (final) void tableActions.resizeColumn(ctx, columnId, next);
    },
    [boardId, ctx],
  );

  const env = useMemo<TableEnv>(
    () => ({
      boardId,
      uid,
      canEdit,
      columns,
      allColumns,
      subitemColumns,
      groups,
      nameWidth: savedNameWidth,
      ctx,
      getModels,
      getItems,
      scrollElement,
      onResize,
    }),
    [
      boardId,
      uid,
      canEdit,
      columns,
      allColumns,
      subitemColumns,
      groups,
      savedNameWidth,
      ctx,
      getModels,
      getItems,
      scrollElement,
      onResize,
    ],
  );

  const cssVars = {
    '--atrium-table-cols': gridTemplate(nameWidth, gridColumns, ADD_TRACK),
    '--atrium-table-width': tableWidth(nameWidth, gridColumns, ADD_TRACK),
    // The live Item width, for the subitem blocks (their name area is this minus an indent).
    '--atrium-table-name-live': `${nameWidth}px`,
  } as CSSProperties;

  // ---- Toolbar actions
  const newItem = async () => {
    const first = groups[0];
    let groupId = first?.id ?? null;
    let all: ItemDoc[] = [];
    if (first) {
      all = modelsRef.current.find((m) => m.group.id === first.id)?.all ?? [];
    } else {
      groupId = await tableActions.addGroup(ctx, 'top', 'Group Title');
    }
    if (!groupId) return;
    useTablePrefs.getState().setGroupCollapsed(boardId, groupId, false);
    const id = await tableActions.addItem(ctx, {
      groupId,
      position: positionBeforeAll(all),
      name: 'New item',
    });
    if (id) {
      const store = useTableStore.getState();
      store.setRenamingItem(id);
      store.setActive({ itemId: id, columnId: NAME_COLUMN });
      scrollElement?.scrollTo({ top: 0 });
    }
  };

  const onDev = async (action: 'seed-1000' | 'seed-roadmap') => {
    const { seedItems, seedRoadmap } = await import('./dev-seed');
    if (action === 'seed-1000') await seedItems(ctx, board, 1000);
    else await seedRoadmap(ctx);
  };

  // ---- Drag and drop (items between and within groups, groups among groups)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragging, setDragging] = useState<{
    type: 'item' | 'subitem' | 'group';
    id: string;
  } | null>(null);
  const hasFilter =
    filterState.personIds.length > 0 ||
    filterState.filterGroup.conditions.length > 0 ||
    filterState.sortConditions.length > 0 ||
    Boolean(filterState.groupByColumnId);
  const dragDisabled = search !== '' || hasFilter;

  const onDragStart = ({ active }: DragStartEvent) => {
    const kind = active.data.current?.type;
    const type = kind === 'group' ? 'group' : kind === 'subitem' ? 'subitem' : 'item';
    setDragging({ type, id: String(active.id) });
    if (type === 'group') useTableStore.getState().setDraggingGroup(true);
  };

  const clearPatch = (id: string) =>
    setPatches((current) => {
      const { [id]: _removed, ...rest } = current;
      return rest;
    });

  /**
   * Where an item being dragged would land if dropped now: the group, the row it sits next to and
   * on which side of it. `null` over the item's own slot or over nothing. Dropping in the same
   * group is handled by the row animation itself; this is what the blue drop marker shows across
   * groups (the row stays where it was until the drop, so the drag keeps one stable element).
   */
  const dropTarget = (active: DragOverEvent['active'], over: DragOverEvent['over']) => {
    if (!over) return null;
    const data = over.data.current;
    const groupId = data?.groupId as string | undefined;
    if (!groupId) return null;
    if (data?.type === 'group-drop') return { groupId, itemId: null, edge: 'before' as const };
    if (over.id === active.id) return null;
    const moved = active.rect.current.translated;
    const below = moved
      ? moved.top + moved.height / 2 > over.rect.top + over.rect.height / 2
      : false;
    return {
      groupId,
      itemId: String(over.id),
      edge: below ? ('after' as const) : ('before' as const),
    };
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (active.data.current?.type !== 'item') return;
    const target = dropTarget(active, over);
    const from = active.data.current?.groupId as string | undefined;
    // Inside its own group the rows already move out of the way: no marker.
    useTableStore.getState().setDropMarker(target && target.groupId !== from ? target : null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const type = active.data.current?.type;
    const target = type === 'group' ? null : dropTarget(active, over);
    setDragging(null);
    useTableStore.getState().setDraggingGroup(false);
    useTableStore.getState().setDropMarker(null);

    if (type === 'group') {
      if (!over || active.id === over.id) return;
      const to = groups.findIndex((g) => groupKey(g.id) === over.id);
      if (to === -1) return;
      void tableActions.moveGroup(ctx, String(active.id).replace(/^group:/, ''), to);
      return;
    }

    if (type === 'subitem') {
      // Reorder inside the parent's block: the drop must be on a sibling subitem.
      const parentId = active.data.current?.parentId as string | undefined;
      if (!over || active.id === over.id || !parentId) return;
      if (over.data.current?.type !== 'subitem' || over.data.current.parentId !== parentId) return;
      const id = String(active.id);
      const siblings = itemsRef.current
        .filter((i) => i.parentItemId === parentId)
        .sort(comparePositions);
      const from = siblings.findIndex((s) => s.id === id);
      const to = siblings.findIndex((s) => s.id === over.id);
      if (from === -1 || to === -1) return;
      const reordered = arrayMove([...siblings], from, to);
      const position = positionBetween(
        reordered[to - 1]?.position ?? null,
        reordered[to + 1]?.position ?? null,
      );
      const sub = siblings[from]!;
      if (position === sub.position) return;
      setPatches((current) => ({ ...current, [id]: { groupId: sub.groupId, position } }));
      void tableActions
        .moveItem(ctx, id, { groupId: sub.groupId, position }, sub)
        .finally(() => clearPatch(id));
      return;
    }

    const id = String(active.id);
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item || !target) return;

    const siblings = modelsRef.current.find((m) => m.group.id === target.groupId)?.all ?? [];
    let position: string;
    if (target.groupId === item.groupId) {
      // Same group: the item takes the target's slot, as the rows showed while dragging.
      const from = siblings.findIndex((s) => s.id === id);
      const to = siblings.findIndex((s) => s.id === target.itemId);
      if (from === -1 || to === -1) return;
      const reordered = arrayMove([...siblings], from, to);
      position = positionBetween(
        reordered[to - 1]?.position ?? null,
        reordered[to + 1]?.position ?? null,
      );
    } else {
      // Another group: next to the row under the pointer, or at the end of an empty or collapsed one.
      const others = siblings.filter((s) => s.id !== id);
      const at = target.itemId ? others.findIndex((s) => s.id === target.itemId) : -1;
      const index = at === -1 ? others.length : at + (target.edge === 'after' ? 1 : 0);
      position = dropPosition(siblings, id, index);
    }

    if (target.groupId === item.groupId && position === item.position) return;
    setPatches((current) => ({ ...current, [id]: { groupId: target.groupId, position } }));
    void tableActions
      .moveItem(ctx, id, { groupId: target.groupId, position }, item)
      .finally(() => clearPatch(id));
  };

  const onDragCancel = () => {
    setDragging(null);
    useTableStore.getState().setDraggingGroup(false);
    useTableStore.getState().setDropMarker(null);
  };

  // ---- Keyboard: arrows move the active cell, Enter edits, Escape leaves, Delete clears
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node) || isTypingTarget(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const store = useTableStore.getState();
    // Arrows move within the block the active cell is in: the table, or one parent's subitems.
    const activeDoc = store.active
      ? itemsRef.current.find((i) => i.id === store.active!.itemId)
      : undefined;
    const parentId = activeDoc?.parentItemId ?? null;
    const scopeColumns = parentId ? subitemColumns : columns;
    const scopeCtx = parentId ? subitemCtx : ctx;
    const rowIds = parentId
      ? itemsRef.current
          .filter((i) => i.parentItemId === parentId)
          .sort(comparePositions)
          .map((i) => i.id)
      : modelsRef.current
          .filter((m) => !(useTablePrefs.getState().collapsed[boardId] ?? []).includes(m.group.id))
          .flatMap((m) => m.items.map((i) => i.id));
    const columnIds = [NAME_COLUMN, ...scopeColumns.map((c) => c.def.id)];

    if (isArrowKey(event.key)) {
      if (store.editing) return;
      event.preventDefault();
      const next = moveActiveCell(store.active, event.key, rowIds, columnIds);
      if (next) {
        store.setActive(next);
        scrollCellIntoView(scrollElement, next.itemId, next.columnId);
      }
      return;
    }

    const active = store.active;
    if (event.key === 'Escape') {
      if (store.editing) store.setEditing(null);
      else if (store.selected.size > 0) store.clearSelection();
      else store.setActive(null);
      return;
    }
    if (!active || !canEdit) return;

    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      if (active.columnId === NAME_COLUMN) {
        store.setRenamingItem(active.itemId);
        return;
      }
      const column = scopeColumns.find((c) => c.def.id === active.columnId);
      const ui = column ? getColumnUi(column.def.type) : undefined;
      // Derived and server-managed cells are read-only: no editor opens and nothing is written.
      if (!column || !ui || isClientReadOnlyType(column.def.type)) return;
      if (ui.editor === 'toggle') {
        const item = itemsRef.current.find((i) => i.id === active.itemId);
        const parsed = columnRegistry.parseValue(column.def.type, item?.values[column.def.id]);
        void tableActions.setCell(
          scopeCtx,
          active.itemId,
          column.def.id,
          ui.toggle?.(parsed.success ? parsed.data : null) ?? null,
          item,
        );
      } else if (ui.editor !== 'none') {
        store.setEditing(active);
      }
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && active.columnId !== NAME_COLUMN) {
      event.preventDefault();
      const clearing = scopeColumns.find((c) => c.def.id === active.columnId);
      if (clearing && isClientReadOnlyType(clearing.def.type)) return;
      void tableActions.setCell(
        scopeCtx,
        active.itemId,
        active.columnId,
        null,
        itemsRef.current.find((i) => i.id === active.itemId),
      );
    }
  };

  const onScroll = () => {
    if (!scrollElement) return;
    scrollElement.style.setProperty(
      '--atrium-table-sticky-active',
      scrollElement.scrollLeft > 0 ? 'var(--atrium-table-sticky-shadow)' : 'none',
    );
  };

  const activeItem =
    dragging && dragging.type !== 'group' ? items.find((i) => i.id === dragging.id) : undefined;
  const activeGroupDef = activeItem ? groups.find((g) => g.id === activeItem.groupId) : undefined;
  const activeIsSubitem = dragging?.type === 'subitem';

  return (
    <TableEnvContext.Provider value={env}>
      <div className={styles.root}>
        <BoardToolbar
          board={board}
          items={items}
          userLookup={lookup}
          onNewItem={() => void newItem()}
          onNewGroup={() => void tableActions.addGroup(ctx, 'top')}
          onDev={(action) => void onDev(action)}
        />
        <div
          ref={setScrollElement}
          className={styles.scroll}
          style={cssVars}
          tabIndex={0}
          aria-label="Board table"
          onKeyDown={onKeyDown}
          onScroll={onScroll}
        >
          <div className={styles.content}>
            {loading ? (
              <div className={styles.empty} role="status">
                <Loader size="medium" />
              </div>
            ) : error ? (
              <p className={styles.empty} role="alert">
                Could not load the items. Check your connection and try again.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDragCancel={onDragCancel}
              >
                <SortableContext
                  items={groups.map((g) => groupKey(g.id))}
                  strategy={verticalListSortingStrategy}
                >
                  {models.map((model) => (
                    <GroupBlock
                      key={model.group.id}
                      model={model}
                      term={search}
                      dragDisabled={dragDisabled}
                    />
                  ))}
                </SortableContext>
                <DragOverlay dropAnimation={null}>
                  {activeItem && activeGroupDef ? (
                    activeIsSubitem ? (
                      <SubitemScope groupColor={activeGroupDef.color}>
                        <ItemRowBody
                          item={activeItem}
                          groupColor={activeGroupDef.color}
                          term=""
                          selected={false}
                          activeColumn={null}
                          editingColumn={null}
                          renaming={false}
                          subitem
                          overlay
                        />
                      </SubitemScope>
                    ) : (
                      <ItemRowBody
                        item={activeItem}
                        groupColor={activeGroupDef.color}
                        term=""
                        selected={false}
                        activeColumn={null}
                        editingColumn={null}
                        renaming={false}
                        overlay
                      />
                    )
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
            {!loading && !error && search !== '' && models.length === 0 ? (
              <p className={styles.empty}>No items match &ldquo;{search}&rdquo;.</p>
            ) : null}
            {!loading && !error && search === '' && canEdit ? (
              <div className={styles.addGroup}>
                <Button
                  kind="secondary"
                  size="small"
                  leftIcon={Add}
                  onClick={() => void tableActions.addGroup(ctx, 'bottom')}
                >
                  Add new group
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        <BatchBar />
      </div>
    </TableEnvContext.Provider>
  );
}

/** Bring a cell into view after the keyboard moved to it (rows of a big group may be unmounted). */
function scrollCellIntoView(scroll: HTMLElement | null, itemId: string, columnId: string): void {
  // Item ids are Firestore ids and column ids short slugs, so neither needs selector escaping.
  const cell = scroll?.querySelector(`[data-cell="${itemId}:${columnId}"]`);
  cell?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
