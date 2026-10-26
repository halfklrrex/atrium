import { BatteryBar } from '../battery/BatteryBar';
import {
  canEditBoard,
  resolveBoardRole,
  statusDistribution,
  type StatusSettings,
  type StatusValue,
} from '@atrium/shared';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
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
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Loader } from '@vibe/core';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { useItems, usePresence, useWorkspace, type BoardDoc, type ItemDoc } from '../../data';
import { positionAfterAll } from '../../lib/positions';
import { useBoardFilter, useFilterStore, useKanbanSettings } from '../board-filters';
import { BoardToolbar } from '../board-table/BoardToolbar';
import { isClientReadOnlyType } from '../board-table/derived';
import { tableActions, type TableCtx } from '../board-table/table-actions';
import { buildColumnViews } from '../board-table/table-model';
import { useTableStore } from '../board-table/table-store';
import { useDeepStable } from '../board-table/useDeepStable';
import { useItemViewStore } from '../item-view/item-view-store';
import { CardBody } from './KanbanCard';
import { KanbanLane, type DropMarker } from './KanbanLane';
import { KanbanSettingsPopover } from './KanbanSettingsPopover';
import {
  buildKanbanLanes,
  isSorted,
  planDrop,
  resolveCardColumns,
  resolveStatusColumn,
  type KanbanLane as LaneModel,
  type KanbanPatch,
} from './kanban-model';
import styles from './kanban.module.css';

const SORTED_TOOLTIP = 'Dragging is off while the view is sorted';

/** Pointer position decides first (cards, then lanes); the closest centre is the keyboard fallback. */
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const typeOf = (id: unknown) =>
    args.droppableContainers.find((d) => d.id === id)?.data.current?.type;
  const cards = within.filter((c) => typeOf(c.id) === 'card');
  if (cards.length > 0) return cards;
  if (within.length > 0) return within;
  return closestCenter(args);
};

export interface KanbanBoardProps {
  board: BoardDoc;
}

/** The Kanban view: toolbar, then one lane per status label with the items as cards. */
export function KanbanBoard({ board }: KanbanBoardProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: workspace } = useWorkspace(board.workspaceId);
  const canEdit = canEditBoard(resolveBoardRole(board, uid, workspace?.roles[uid]));
  const { data: items, loading, error } = useItems(board.id);
  const { viewers } = usePresence(board.id);
  const boardId = board.id;

  const lookup = useCallback(
    (targetUid: string): string | undefined => {
      if (user && targetUid === user.uid) return user.displayName ?? user.email ?? 'You';
      return viewers.find((v) => v.uid === targetUid)?.displayName || undefined;
    },
    [user, viewers],
  );

  // Search is per session: a fresh board starts without it.
  useEffect(() => {
    useTableStore.getState().reset(boardId);
  }, [boardId]);

  const columnDefs = useDeepStable(board.columns);
  const subitemDefs = useDeepStable(board.subitemColumns ?? []);
  const groupDefs = useDeepStable(board.groups);
  const columns = useMemo(() => buildColumnViews(columnDefs), [columnDefs]);
  const kanban = useKanbanSettings(boardId);
  const status = useMemo(
    () => resolveStatusColumn(columns, kanban.columnId),
    [columns, kanban.columnId],
  );
  const statusId = status?.def.id ?? null;
  const fields = useMemo(
    () => resolveCardColumns(columns, kanban, statusId),
    [columns, kanban, statusId],
  );

  const { filterState } = useBoardFilter(boardId);
  const search = useDeferredValue(useTableStore((s) => s.search)).trim();
  const [patches, setPatches] = useState<Record<string, KanbanPatch>>({});
  const lanes = useMemo(
    () =>
      status
        ? buildKanbanLanes({ items, status, columns, filterState, search, patches, kanban })
        : [],
    [items, status, columns, filterState, search, patches, kanban],
  );
  const subitemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.parentItemId)
        counts.set(item.parentItemId, (counts.get(item.parentItemId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  // Live reads for event handlers, without re-creating them on every snapshot.
  const lanesRef = useRef<LaneModel[]>(lanes);
  const itemsRef = useRef<ItemDoc[]>(items);
  useEffect(() => {
    lanesRef.current = lanes;
    itemsRef.current = items;
  });
  // The full item view steps through the cards shown here (lane by lane).
  useEffect(() => {
    useItemViewStore
      .getState()
      .setVisible(boardId, [
        { groupId: 'kanban', ids: lanes.flatMap((lane) => lane.items.map((i) => i.id)) },
      ]);
  }, [boardId, lanes]);

  const ctx = useMemo<TableCtx>(
    () => ({
      boardId,
      uid,
      columns: columnDefs,
      subitemColumns: subitemDefs,
      getItems: () => itemsRef.current,
      getGroups: () => groupDefs,
    }),
    [boardId, uid, columnDefs, subitemDefs, groupDefs],
  );

  // ---- Who can do what
  const canWrite = canEdit && status !== null && !isClientReadOnlyType('status');
  const sorted = isSorted(filterState);
  // `null` = draggable; text = not draggable (and the card's tooltip, when there is any).
  const dragOff = !canWrite ? '' : sorted ? SORTED_TOOLTIP : null;

  // ---- Drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space picks a card up and drops it; Enter opens the card, so it is not a drag key.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [marker, setMarker] = useState<DropMarker | null>(null);

  const clearPatch = (id: string) =>
    setPatches((current) => {
      const { [id]: _removed, ...rest } = current;
      return rest;
    });

  const laneOf = (id: string): LaneModel | undefined =>
    lanesRef.current.find((lane) => lane.items.some((i) => i.id === id));

  /** The lane under the pointer and where in it: next to a card, or at the end of the lane. */
  const targetOf = (active: DragOverEvent['active'], over: DragOverEvent['over']) => {
    if (!over) return null;
    const data = over.data.current;
    const laneKey = data?.laneKey as string | undefined;
    if (!laneKey) return null;
    if (data?.type === 'lane') return { laneKey, itemId: null, edge: 'before' as const };
    if (over.id === active.id) return null;
    const moved = active.rect.current.translated;
    const below = moved
      ? moved.top + moved.height / 2 > over.rect.top + over.rect.height / 2
      : false;
    return {
      laneKey,
      itemId: String(over.id),
      edge: below ? ('after' as const) : ('before' as const),
    };
  };

  const onDragStart = ({ active }: DragStartEvent) => setDraggingId(String(active.id));

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const target = targetOf(active, over);
    const from = active.data.current?.laneKey as string | undefined;
    // Inside its own lane the cards already move out of the way: no marker.
    setMarker(target && target.laneKey !== from ? target : null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const target = targetOf(active, over);
    setDraggingId(null);
    setMarker(null);
    if (!target || !status) return;
    const id = String(active.id);
    const item = itemsRef.current.find((i) => i.id === id);
    const from = laneOf(id);
    const to = lanesRef.current.find((lane) => lane.key === target.laneKey);
    if (!item || !from || !to) return;

    const others = to.items.filter((i) => i.id !== id);
    let index: number;
    if (target.itemId === null) {
      index = others.length;
    } else if (from.key === to.key) {
      // Same lane: the card takes the target's slot, as the cards showed while dragging.
      index = to.items.findIndex((i) => i.id === target.itemId);
    } else {
      const at = others.findIndex((i) => i.id === target.itemId);
      index = at === -1 ? others.length : at + (target.edge === 'after' ? 1 : 0);
    }
    if (index < 0) return;

    const plan = planDrop({ item, from, to, index });
    if (!plan) return;
    // Show the card in its new place at once; a refused write rolls back (with an error toast).
    setPatches((current) => ({
      ...current,
      [id]: { value: plan.value === undefined ? from.value : plan.value, position: plan.position },
    }));
    const write =
      plan.value === undefined
        ? tableActions.moveItem(ctx, id, { groupId: item.groupId, position: plan.position }, item)
        : tableActions.setCellAndMove(ctx, id, status.def.id, plan.value, plan.position, item);
    void write.finally(() => clearPatch(id));
  };

  const onDragCancel = () => {
    setDraggingId(null);
    setMarker(null);
  };

  // ---- "+ Add item" in a lane: the board's first group, the lane's status, last in the lane.
  const onAdd = useCallback(
    async (lane: LaneModel, name: string) => {
      if (!status) return;
      let groupId = [...groupDefs].sort((a, b) => (a.position < b.position ? -1 : 1))[0]?.id;
      if (!groupId) groupId = (await tableActions.addGroup(ctx, 'top', 'Group Title')) ?? undefined;
      if (!groupId) return;
      await tableActions.addItem(ctx, {
        groupId,
        position: positionAfterAll(lane.all),
        name,
        ...(lane.value ? { values: { [status.def.id]: lane.value } } : {}),
      });
    },
    [status, groupDefs, ctx],
  );

  const onToggle = useCallback(
    (laneKey: string) => useFilterStore.getState().toggleLane(boardId, laneKey),
    [boardId],
  );

  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

  const activeItem = draggingId
    ? lanes.flatMap((l) => l.items).find((i) => i.id === draggingId)
    : undefined;

  const battery = useMemo(() => {
    if (!status) return null;
    const values = lanes.flatMap((lane) => lane.items.map((i) => i.values[status.def.id]));
    return statusDistribution(
      values as (StatusValue | null | undefined)[],
      status.settings as StatusSettings,
    );
  }, [lanes, status]);

  const trailing = (
    <>
      {battery && battery.total > 0 ? (
        <BatteryBar
          className={styles.battery}
          segments={battery.segments}
          total={battery.total}
          label={`${status?.def.title ?? 'Status'} summary`}
        />
      ) : null}
      <KanbanSettingsPopover
        boardId={boardId}
        columns={columns}
        statusColumnId={statusId}
        cardColumns={fields}
        settings={kanban}
      />
    </>
  );

  return (
    <div className={styles.root}>
      <BoardToolbar
        board={board}
        items={items}
        userLookup={lookup}
        variant="kanban"
        trailing={trailing}
      />
      <div ref={setScrollElement} className={styles.scroll} aria-label="Kanban board">
        {loading ? (
          <div className={styles.empty} role="status">
            <Loader size="medium" />
          </div>
        ) : error ? (
          <p className={styles.empty} role="alert">
            Could not load the items. Check your connection and try again.
          </p>
        ) : !status ? (
          <p className={styles.empty}>
            Kanban groups cards by a status column. Add a status column to this board to use it.
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
            <div className={styles.lanes}>
              {lanes.map((lane) => (
                <KanbanLane
                  key={lane.key}
                  lane={lane}
                  boardId={boardId}
                  columnDefs={columnDefs}
                  fields={fields}
                  subitemCounts={subitemCounts}
                  dragOff={dragOff}
                  canEdit={canWrite}
                  marker={marker}
                  scrollElement={scrollElement}
                  onToggle={onToggle}
                  onAdd={onAdd}
                />
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {activeItem ? (
                <CardBody
                  item={activeItem}
                  boardId={boardId}
                  columnDefs={columnDefs}
                  fields={fields}
                  subitemCount={subitemCounts.get(activeItem.id) ?? 0}
                  laneKey=""
                  dragOff={null}
                  canEdit={false}
                  overlay
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
