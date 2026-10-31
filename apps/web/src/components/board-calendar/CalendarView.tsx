import { canEditBoard, resolveBoardRole } from '@atrium/shared';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { Button, Loader } from '@vibe/core';
import { Add, NavigationChevronLeft, NavigationChevronRight } from '@vibe/icons';
import classNames from 'classnames';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useAuth } from '../../auth/auth-context';
import { useItems, useUserLookup, useWorkspace, type BoardDoc, type ItemDoc } from '../../data';
import { WEEKDAY_NAMES, fullDateLabel, parseIsoDay, todayIso } from '../../lib/date-grid';
import {
  useActiveViewId,
  useBoardFilter,
  useFilterStore,
  useViewTypeSettings,
  viewKey,
} from '../board-filters';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import { BoardToolbar } from '../board-table/BoardToolbar';
import { isColumnReadOnlyForUser } from '../board-table/derived';
import { openItemFull } from '../board-table/open-item';
import { tableActions, type TableCtx } from '../board-table/table-actions';
import { buildColumnViews } from '../board-table/table-model';
import { useTableStore } from '../board-table/table-store';
import { useDeepStable } from '../board-table/useDeepStable';
import { useItemViewStore } from '../item-view/item-view-store';
import { addItemOnDay } from '../board-date-views/add-item-on-day';
import { ColorLegend, DateViewEmpty } from '../board-date-views/DateViewParts';
import {
  CALENDAR_COLUMN_TYPES,
  buildCalendar,
  dayDropId,
  hiddenOnDay,
  laneCapacity,
  planMove,
  resolveCalendarColumn,
  shiftAnchor,
  type CalendarPatches,
  type CalendarSegment,
  type CalendarWeek,
} from './calendar-model';
import { useCalendarUi } from './calendar-store';
import { CalendarSettingsPopover } from './CalendarSettingsPopover';
import styles from './calendar.module.css';

/** Bars per cell until the real cell height is known (jsdom, first paint). */
const DEFAULT_CAPACITY = 3;

/** Pointer position decides first (the cell under it); the closest centre is the keyboard fallback. */
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

/** A token's pixel value from the computed style, for the lane maths (fallback outside a browser). */
function readPx(element: HTMLElement, name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/** How many bar rows fit in this week row's cells, kept up to date as the row resizes. */
function useLaneCapacity(ref: React.RefObject<HTMLElement | null>): number {
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const pill = readPx(element, '--atrium-calendar-pill-height', 20);
      const gap = readPx(element, '--atrium-calendar-pill-gap', 4);
      setCapacity(
        laneCapacity(element.clientHeight, {
          header: readPx(element, '--atrium-calendar-day-header', 28),
          row: pill + gap,
          more: readPx(element, '--atrium-calendar-more-height', 20),
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return capacity;
}

export interface CalendarViewProps {
  board: BoardDoc;
}

/** The Calendar view: toolbar with the period controls, then the month or week grid. */
export function CalendarView({ board }: CalendarViewProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: workspace } = useWorkspace(board.workspaceId);
  const boardRole = resolveBoardRole(board, uid, workspace?.roles[uid]);
  const canEdit = canEditBoard(boardRole);
  const { data: items, loading, error } = useItems(board.id);
  const memberLookup = useUserLookup(board.workspaceId);
  const boardId = board.id;
  const viewId = useActiveViewId(boardId);

  const lookup = useCallback(
    (targetUid: string): string | undefined => memberLookup(targetUid)?.name,
    [memberLookup],
  );

  // Search is per session: a fresh board starts without it.
  useEffect(() => {
    useTableStore.getState().reset(boardId);
  }, [boardId]);

  const columnDefs = useDeepStable(board.columns);
  const subitemDefs = useDeepStable(board.subitemColumns ?? []);
  const groupDefs = useDeepStable(board.groups);
  const columnLocks = useDeepStable(board.columnLocks ?? []);
  const boardLocks = useMemo(() => ({ columnLocks }), [columnLocks]);
  const columns = useMemo(() => buildColumnViews(columnDefs), [columnDefs]);
  const settings = useViewTypeSettings(boardId, 'calendar');
  const timeColumns = useMemo(
    () => columns.filter((c) => (CALENDAR_COLUMN_TYPES as readonly string[]).includes(c.def.type)),
    [columns],
  );
  const column = useMemo(
    () => resolveCalendarColumn(columns, settings.columnId),
    [columns, settings.columnId],
  );

  const { filterState } = useBoardFilter(boardId);
  const search = useDeferredValue(useTableStore((s) => s.search)).trim();
  const [patches, setPatches] = useState<CalendarPatches>({});

  const uiKey = viewKey(boardId, viewId);
  const anchor = useCalendarUi((s) => s.anchors[uiKey]) ?? todayIso();
  const setAnchor = (day: string) => useCalendarUi.getState().setAnchor(uiKey, day);

  const model = useMemo(
    () =>
      column
        ? buildCalendar({
            items,
            column,
            columns,
            groups: groupDefs,
            filterState,
            search,
            patches,
            settings,
            anchor,
          })
        : null,
    [items, column, columns, groupDefs, filterState, search, patches, settings, anchor],
  );

  const itemsRef = useRef<ItemDoc[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  // The full item view steps through the items shown here, in order.
  const visibleIds = model?.visibleIds;
  useEffect(() => {
    useItemViewStore
      .getState()
      .setVisible(boardId, [{ groupId: 'calendar', ids: visibleIds ?? [] }]);
  }, [boardId, visibleIds]);

  const ctx = useMemo<TableCtx>(
    () => ({
      boardId,
      uid,
      columns: columnDefs,
      subitemColumns: subitemDefs,
      board: boardLocks,
      boardRole,
      getItems: () => itemsRef.current,
      getGroups: () => groupDefs,
    }),
    [boardId, uid, columnDefs, subitemDefs, boardLocks, boardRole, groupDefs],
  );

  // ---- Who can do what: editors, on a column that is not derived, server-managed or locked.
  const canWrite =
    canEdit &&
    column !== null &&
    !isColumnReadOnlyForUser(
      column.def.type,
      boardLocks,
      column.def.id,
      boardRole,
      !!column.def.migrating,
    );

  // ---- Drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: calendarKeyboardCoordinates,
      // Space picks a pill up and drops it; Enter opens the item, so it is not a drag key.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );
  const grabDay = useRef<string | null>(null);

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const startDay = active.data.current?.startDay as string | undefined;
    grabDay.current = startDay ?? null;
    // Where on a multi-day bar the pointer took hold decides which day it lands on.
    if (
      activatorEvent instanceof PointerEvent &&
      typeof document.elementsFromPoint === 'function'
    ) {
      const cell = document
        .elementsFromPoint(activatorEvent.clientX, activatorEvent.clientY)
        .find((element) => element instanceof HTMLElement && element.dataset.day);
      const day = cell instanceof HTMLElement ? cell.dataset.day : undefined;
      if (day) grabDay.current = day;
    }
  };

  const clearPatch = (id: string) =>
    setPatches((current) => {
      const { [id]: _removed, ...rest } = current;
      return rest;
    });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const dropDay = over?.data.current?.day as string | undefined;
    const from = grabDay.current ?? (active.data.current?.startDay as string | undefined);
    grabDay.current = null;
    if (!dropDay || !from || !column) return;
    const id = String(active.data.current?.itemId ?? '');
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item) return;
    const plan = planMove(item, column, from, dropDay);
    if (!plan) return;
    // Show the item on its new day at once; a refused write rolls back (with an error toast).
    setPatches((current) => ({ ...current, [id]: plan.value }));
    void tableActions
      .setCell(ctx, id, column.def.id, plan.value, item)
      .finally(() => clearPatch(id));
  };

  const onDragCancel = () => {
    grabDay.current = null;
  };

  // ---- Add an item on a day: the board's first group, the column set to that day.
  const lockCtx = useMemo(() => ({ board: boardLocks, boardRole }), [boardLocks, boardRole]);
  const addOnDay = useCallback(
    (day: string) =>
      addItemOnDay({
        ctx,
        boardId,
        column,
        canWrite,
        columnDefs,
        lockCtx,
        groupDefs,
        items: itemsRef.current,
        day,
      }),
    [ctx, boardId, column, canWrite, columnDefs, lockCtx, groupDefs],
  );

  // ---- Keyboard: arrows move between days.
  const rootRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => model?.weeks.flatMap((w) => w.days) ?? [], [model]);
  const columnsPerWeek = model?.weeks[0]?.days.length ?? 7;
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const tabDay =
    focusDay && days.includes(focusDay) ? focusDay : (days.find((d) => d >= anchor) ?? days[0]);
  const onGridKeyDown = (event: KeyboardEvent<HTMLElement>, day: string) => {
    if (event.target !== event.currentTarget) return;
    const step =
      event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowDown'
            ? columnsPerWeek
            : event.key === 'ArrowUp'
              ? -columnsPerWeek
              : 0;
    if (step === 0) return;
    const target = days[days.indexOf(day) + step];
    if (!target) return;
    event.preventDefault();
    setFocusDay(target);
    rootRef.current?.querySelector<HTMLElement>(`[data-day="${target}"]`)?.focus();
  };

  const mode = settings.mode;
  const periodControls = model ? (
    <>
      <span className={styles.divider} role="separator" aria-orientation="vertical" />
      <Button kind="secondary" size="small" onClick={() => setAnchor(todayIso())}>
        Today
      </Button>
      <Button
        kind="tertiary"
        size="small"
        aria-label={mode === 'month' ? 'Previous month' : 'Previous week'}
        onClick={() => setAnchor(shiftAnchor(anchor, mode, -1))}
      >
        <NavigationChevronLeft aria-hidden="true" />
      </Button>
      <Button
        kind="tertiary"
        size="small"
        aria-label={mode === 'month' ? 'Next month' : 'Next week'}
        onClick={() => setAnchor(shiftAnchor(anchor, mode, 1))}
      >
        <NavigationChevronRight aria-hidden="true" />
      </Button>
      <h2 className={styles.title} aria-live="polite">
        {model.title}
      </h2>
      <select
        className={styles.modeSelect}
        aria-label="Calendar mode"
        value={mode}
        onChange={(event) =>
          useFilterStore.getState().setTypeSettings(boardId, 'calendar', {
            mode: event.target.value === 'week' ? 'week' : 'month',
          })
        }
      >
        <option value="month">Month</option>
        <option value="week">Week</option>
      </select>
    </>
  ) : null;

  const trailing = (
    <CalendarSettingsPopover
      boardId={boardId}
      timeColumns={timeColumns}
      columns={columns}
      columnId={column?.def.id ?? null}
      settings={settings}
    />
  );

  return (
    <div className={styles.root}>
      <BoardToolbar
        board={board}
        items={items}
        userLookup={lookup}
        variant="calendar"
        canAddItem={canWrite}
        onNewItem={() => void addOnDay(todayIso())}
        after={periodControls}
        trailing={trailing}
      />
      <div className={styles.scroll} aria-label="Calendar" ref={rootRef}>
        {loading ? (
          <div className={styles.empty} role="status">
            <Loader size="medium" />
          </div>
        ) : error ? (
          <p className={styles.empty} role="alert">
            Could not load the items. Check your connection and try again.
          </p>
        ) : !model || !column ? (
          <DateViewEmpty
            canEdit={canEdit}
            onAddColumn={(type) => void tableActions.addColumn(ctx, type)}
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <div
              className={classNames(styles.grid, mode === 'week' && styles.gridWeek)}
              role="grid"
              aria-label={model.title}
              aria-rowcount={model.weeks.length + 1}
            >
              <div
                className={styles.weekdays}
                role="row"
                style={{ '--calendar-columns': model.weeks[0]!.days.length } as CSSProperties}
              >
                {model.weeks[0]!.days.map((day) => (
                  <div key={day} className={styles.weekday} role="columnheader">
                    {WEEKDAY_NAMES[parseIsoDay(day).getUTCDay()]!.slice(0, 3)}
                  </div>
                ))}
              </div>
              {model.weeks.map((week) => (
                <WeekRow
                  key={week.days[0]}
                  week={week}
                  today={todayIso()}
                  dragOff={!canWrite}
                  canAdd={canWrite}
                  tabDay={tabDay}
                  onFocusDay={setFocusDay}
                  onKeyDown={onGridKeyDown}
                  onAdd={(day) => void addOnDay(day)}
                  onOpen={(id) => openItemFull(boardId, id)}
                />
              ))}
            </div>
          </DndContext>
        )}
        {model ? <ColorLegend entries={model.legend} /> : null}
      </div>
    </div>
  );
}

/**
 * Space-and-arrows drag: each arrow moves the picked-up pill to the neighbouring day cell (a week
 * for up and down) instead of a few pixels.
 */
const calendarKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context: { active, over, collisionRect, droppableRects } },
) => {
  const dayStep: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
  const weekStep: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
  if (!collisionRect || !(event.code in dayStep || event.code in weekStep)) return undefined;
  event.preventDefault();
  const current = String(over?.id ?? '');
  if (!current.startsWith('day:')) return undefined;
  const ids = [...droppableRects.keys()].map(String).filter((id) => id.startsWith('day:'));
  ids.sort();
  const index = ids.indexOf(current);
  // A week is the number of cells in the first row: the cells that share the first cell's top.
  const firstTop = droppableRects.get(ids[0]!)?.top;
  const perWeek = ids.filter((id) => droppableRects.get(id)?.top === firstTop).length || 7;
  const target = ids[index + (dayStep[event.code] ?? 0) + (weekStep[event.code] ?? 0) * perWeek];
  const rect = target ? droppableRects.get(target) : undefined;
  if (!rect || !active) return undefined;
  return {
    x: rect.left + rect.width / 2 - collisionRect.width / 2,
    y: rect.top + rect.height / 2 - collisionRect.height / 2,
  };
};

interface WeekRowProps {
  week: CalendarWeek;
  today: string;
  /** Pills can't be dragged (viewers, locked or derived column). */
  dragOff: boolean;
  canAdd: boolean;
  tabDay: string | undefined;
  onFocusDay: (day: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, day: string) => void;
  onAdd: (day: string) => void;
  onOpen: (itemId: string) => void;
}

/** One row of day cells; the bars start in the cell of their first day and reach over the next ones. */
function WeekRow({
  week,
  today,
  dragOff,
  canAdd,
  tabDay,
  onFocusDay,
  onKeyDown,
  onAdd,
  onOpen,
}: WeekRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const capacity = useLaneCapacity(rowRef);
  const [more, setMore] = useState<{ day: string; anchor: HTMLElement } | null>(null);

  return (
    <div
      ref={rowRef}
      className={styles.week}
      role="row"
      style={{ '--calendar-columns': week.days.length } as CSSProperties}
    >
      {week.days.map((day, col) => {
        const hidden = hiddenOnDay(week, day, capacity);
        return (
          <DayCell
            key={day}
            day={day}
            today={day === today}
            canAdd={canAdd}
            tabbable={day === tabDay}
            moreCount={hidden.length}
            segments={week.segments.filter((s) => s.colStart === col && s.lane < capacity)}
            dragOff={dragOff}
            onFocusDay={onFocusDay}
            onKeyDown={onKeyDown}
            onAdd={onAdd}
            onOpen={onOpen}
            onMore={(anchor) => setMore({ day, anchor })}
          />
        );
      })}
      {more ? (
        <AnchoredPopup
          anchor={more.anchor}
          onClose={() => setMore(null)}
          label={`Items on ${fullDateLabel(more.day)}`}
        >
          <div className={styles.morePopup}>
            <h3 className={styles.morePopupTitle}>{fullDateLabel(more.day)}</h3>
            <ul className={styles.morePopupList}>
              {(week.perDay[more.day] ?? []).map((segment) => (
                <li key={segment.key}>
                  <button
                    type="button"
                    className={styles.morePopupItem}
                    onClick={() => {
                      setMore(null);
                      onOpen(segment.item.id);
                    }}
                  >
                    <span
                      className={styles.legendDot}
                      style={segment.color ? { background: segment.color } : undefined}
                      aria-hidden="true"
                    />
                    <span className={styles.morePopupText}>{segment.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </AnchoredPopup>
      ) : null}
    </div>
  );
}

interface DayCellProps {
  day: string;
  today: boolean;
  canAdd: boolean;
  tabbable: boolean;
  moreCount: number;
  segments: CalendarSegment[];
  dragOff: boolean;
  onFocusDay: (day: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, day: string) => void;
  onAdd: (day: string) => void;
  onOpen: (itemId: string) => void;
  onMore: (anchor: HTMLElement) => void;
}

function DayCell({
  day,
  today,
  canAdd,
  tabbable,
  moreCount,
  segments,
  dragOff,
  onFocusDay,
  onKeyDown,
  onAdd,
  onOpen,
  onMore,
}: DayCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: dayDropId(day),
    data: { day },
    disabled: dragOff,
  });
  const label = fullDateLabel(day);
  return (
    <div
      ref={setNodeRef}
      className={classNames(styles.cell, isOver && styles.cellOver)}
      role="gridcell"
      aria-label={label}
      aria-current={today ? 'date' : undefined}
      tabIndex={tabbable ? 0 : -1}
      data-day={day}
      onFocus={(event) => event.target === event.currentTarget && onFocusDay(day)}
      onKeyDown={(event) => onKeyDown(event, day)}
    >
      <div className={styles.cellHead}>
        {canAdd ? (
          <button
            type="button"
            className={styles.addDay}
            aria-label={`Add item on ${label}`}
            onClick={() => onAdd(day)}
          >
            <Add aria-hidden="true" />
          </button>
        ) : null}
        <span className={classNames(styles.dayNumber, today && styles.dayToday)}>
          {parseIsoDay(day).getUTCDate()}
        </span>
      </div>
      {segments.map((segment) => (
        <Pill key={segment.key} segment={segment} dragOff={dragOff} onOpen={onOpen} />
      ))}
      {moreCount > 0 ? (
        <button
          type="button"
          className={styles.more}
          aria-label={`${moreCount} more on ${label}`}
          onClick={(event) => onMore(event.currentTarget)}
        >
          +{moreCount} more
        </button>
      ) : null}
    </div>
  );
}

function Pill({
  segment,
  dragOff,
  onOpen,
}: {
  segment: CalendarSegment;
  dragOff: boolean;
  onOpen: (itemId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: segment.key,
    data: {
      itemId: segment.item.id,
      startDay: segment.startDay,
    },
    disabled: dragOff,
  });
  const style: CSSProperties = {
    '--calendar-span': segment.colSpan,
    '--calendar-lane': segment.lane,
    ...(segment.color ? { '--calendar-pill-color': segment.color } : {}),
    ...(transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : {}),
  } as CSSProperties;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // dnd-kit's keyboard sensor listens here too (Space picks the pill up).
    (listeners?.onKeyDown as ((e: KeyboardEvent<HTMLDivElement>) => void) | undefined)?.(event);
    if (event.key === 'Enter' && !isDragging) {
      event.preventDefault();
      event.stopPropagation();
      onOpen(segment.item.id);
    }
  };
  return (
    <div
      {...attributes}
      {...listeners}
      ref={setNodeRef}
      style={style}
      className={classNames(
        styles.pill,
        segment.tone === 'light' ? styles.pillLight : styles.pillDark,
        segment.continuesBefore && styles.pillContinuesBefore,
        segment.continuesAfter && styles.pillContinuesAfter,
        isDragging && styles.pillDragging,
      )}
      role="button"
      tabIndex={0}
      aria-label={segment.label}
      aria-roledescription="calendar item"
      data-item={segment.item.id}
      onClick={() => onOpen(segment.item.id)}
      onKeyDown={onKeyDown}
    >
      <span className={styles.pillText}>{segment.text}</span>
    </div>
  );
}
