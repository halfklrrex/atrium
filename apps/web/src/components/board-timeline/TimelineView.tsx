import {
  canEditBoard,
  resolveBoardRole,
  TIMELINE_LIMITS,
  type TimelineViewSettings,
} from '@atrium/shared';
import { Button, Loader } from '@vibe/core';
import {
  NavigationChevronDown,
  NavigationChevronLeft,
  NavigationChevronRight,
  Settings,
} from '@vibe/icons';
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
  type PointerEvent,
} from 'react';
import { useAuth } from '../../auth/auth-context';
import { useItems, useUserLookup, useWorkspace, type BoardDoc, type ItemDoc } from '../../data';
import { isWeekend, todayIso, weekdayOf } from '../../lib/date-grid';
import {
  useActiveViewId,
  useBoardFilter,
  useFilterStore,
  useViewTypeSettings,
  viewKey,
} from '../board-filters';
import { addItemOnDay } from '../board-date-views/add-item-on-day';
import { ColorLegend, DateViewEmpty } from '../board-date-views/DateViewParts';
import { BoardToolbar } from '../board-table/BoardToolbar';
import { isColumnReadOnlyForUser } from '../board-table/derived';
import { openItemFull } from '../board-table/open-item';
import { tableActions, type TableCtx } from '../board-table/table-actions';
import { buildColumnViews } from '../board-table/table-model';
import { useTableStore } from '../board-table/table-store';
import { useDeepStable } from '../board-table/useDeepStable';
import { useItemViewStore } from '../item-view/item-view-store';
import {
  TIMELINE_COLUMN_TYPES,
  WINDOW_THRESHOLD_ROWS,
  buildTimeline,
  dragRangeText,
  planDrag,
  resolveDrag,
  resolveTimelineColumn,
  windowLanes,
  type DragKind,
  type TimelineBar,
  type TimelineLane,
  type TimelineModel,
  type TimelineZoom,
} from './timeline-model';
import { useTimelineUi } from './timeline-store';
import { TimelineSettingsPanel } from './TimelineSettingsPanel';
import styles from './timeline.module.css';

/** Pixels the pointer must travel before a press on a bar becomes a drag (below it, a click). */
const DRAG_THRESHOLD_PX = 4;
const DEFAULT_ROW_HEIGHT = 32;
const ZOOM_LABELS: Record<TimelineZoom, string> = {
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
};

/** A token's pixel value from the computed style (fallback outside a browser). */
function readPx(element: HTMLElement, name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface TimelineViewProps {
  board: BoardDoc;
}

/** The Timeline view: toolbar with the zoom, a lane per group on a day axis, and the settings panel. */
export function TimelineView({ board }: TimelineViewProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { data: workspace } = useWorkspace(board.workspaceId);
  const boardRole = resolveBoardRole(board, uid, workspace?.roles[uid]);
  const canEdit = canEditBoard(boardRole);
  const { data: items, loading, error } = useItems(board.id);
  const memberLookup = useUserLookup(board.workspaceId);
  const boardId = board.id;
  const viewId = useActiveViewId(boardId);
  const uiKey = viewKey(boardId, viewId);

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
  const settings = useViewTypeSettings(boardId, 'timeline');
  const timeColumns = useMemo(
    () => columns.filter((c) => (TIMELINE_COLUMN_TYPES as readonly string[]).includes(c.def.type)),
    [columns],
  );
  const column = useMemo(
    () => resolveTimelineColumn(columns, settings.columnId),
    [columns, settings.columnId],
  );

  const { filterState } = useBoardFilter(boardId);
  const search = useDeferredValue(useTableStore((s) => s.search)).trim();
  const [patches, setPatches] = useState<Readonly<Record<string, unknown>>>({});
  const today = useMemo(() => todayIso(), []);

  const settingsOpen = useTimelineUi((s) => s.settingsOpen[uiKey] ?? false);
  const paneHidden = useTimelineUi((s) => s.paneHidden[uiKey] ?? false);

  const model = useMemo(
    () =>
      column
        ? buildTimeline({
            items,
            column,
            columns,
            groups: groupDefs,
            filterState,
            search,
            patches,
            settings,
            today,
          })
        : null,
    [items, column, columns, groupDefs, filterState, search, patches, settings, today],
  );

  const itemsRef = useRef<ItemDoc[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  });
  // The full item view steps through the items shown here, lane by lane.
  const visibleIds = model?.visibleIdsByLane;
  useEffect(() => {
    useItemViewStore.getState().setVisible(boardId, visibleIds ?? []);
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
    !isColumnReadOnlyForUser(column.def.type, boardLocks, column.def.id, boardRole);

  // ---- Changing a bar: show the new dates at once; a refused write rolls back (with an error toast).
  const clearPatch = (id: string) =>
    setPatches((current) => {
      const { [id]: _removed, ...rest } = current;
      return rest;
    });

  const commit = (bar: TimelineBar, kind: DragKind, k: number) => {
    if (!column || !model) return;
    const plan = planDrag(bar, column, model.axis, kind, k);
    if (!plan) return;
    const id = bar.item.id;
    const item = itemsRef.current.find((i) => i.id === id) ?? bar.item;
    setPatches((current) => ({ ...current, [id]: plan.value }));
    void tableActions
      .setCell(ctx, id, column.def.id, plan.value, item)
      .finally(() => clearPatch(id));
  };

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

  // ---- Lanes: collapse one or all.
  const setCollapsed = (ids: string[]) =>
    useFilterStore.getState().setTypeSettings(boardId, 'timeline', {
      collapsedGroupIds: ids.slice(-TIMELINE_LIMITS.collapsedGroups),
    });
  const toggleLane = (groupId: string) => {
    const existing = new Set(groupDefs.map((g) => g.id));
    const current = settings.collapsedGroupIds.filter((id) => existing.has(id));
    setCollapsed(
      current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId],
    );
  };
  const allCollapsed = !!model && model.lanes.length > 0 && model.lanes.every((l) => l.collapsed);
  const toggleAll = () =>
    setCollapsed(allCollapsed ? [] : (model?.lanes.map((l) => l.group.id) ?? []));

  // ---- Scrolling: remember the position per view, centre today the first time and on zoom.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rowWindow, setRowWindow] = useState({ first: 0, last: 60 });
  const rowHeight = useRef(DEFAULT_ROW_HEIGHT);
  const ready = !loading && !error && !!model && !!column;

  const centreOnToday = useCallback(
    (smooth: boolean) => {
      const element = scrollRef.current;
      if (!element || !model) return;
      const pane = readPx(element, '--tl-pane-width', 0);
      const todayX = (Math.min(model.todayIdx, model.axis.days.length - 1) + 0.5) * model.dayWidth;
      const left = Math.max(0, todayX - (element.clientWidth - pane) / 2);
      const behavior = smooth && !prefersReducedMotion() ? 'smooth' : 'auto';
      if (typeof element.scrollTo === 'function') element.scrollTo({ left, behavior });
      else element.scrollLeft = left;
    },
    [model],
  );

  const positioned = useRef(false);
  const lastZoom = useRef(settings.zoom);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!ready || !element) return;
    if (!positioned.current) {
      positioned.current = true;
      const saved = useTimelineUi.getState().scroll[uiKey];
      if (saved) {
        element.scrollLeft = saved.left;
        element.scrollTop = saved.top;
      } else centreOnToday(false);
    } else if (lastZoom.current !== settings.zoom) centreOnToday(false);
    lastZoom.current = settings.zoom;
  }, [ready, settings.zoom, uiKey, centreOnToday]);

  const windowed = !!model && model.totalRows > WINDOW_THRESHOLD_ROWS;
  const measureWindow = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    rowHeight.current = readPx(element, '--atrium-timeline-row-height', DEFAULT_ROW_HEIGHT);
    const first = Math.floor(element.scrollTop / rowHeight.current);
    const last = first + Math.ceil((element.clientHeight || 600) / rowHeight.current);
    setRowWindow((w) => (w.first === first && w.last === last ? w : { first, last }));
  }, []);
  useLayoutEffect(() => {
    if (windowed) measureWindow();
  }, [windowed, measureWindow]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    useTimelineUi.getState().setScroll(uiKey, { left: element.scrollLeft, top: element.scrollTop });
    if (windowed) measureWindow();
  };

  const laneWindows = useMemo(
    () => (model ? windowLanes(model.lanes, rowWindow.first, rowWindow.last) : []),
    [model, rowWindow],
  );

  // ---- Toolbar
  const zoom = settings.zoom;
  const controls = ready ? (
    <>
      <span className={styles.divider} role="separator" aria-orientation="vertical" />
      <Button kind="secondary" size="small" onClick={() => centreOnToday(true)}>
        Today
      </Button>
      <select
        className={styles.zoomSelect}
        aria-label="Timeline zoom"
        value={zoom}
        onChange={(event) =>
          useFilterStore.getState().setTypeSettings(boardId, 'timeline', {
            zoom:
              event.target.value === 'days' || event.target.value === 'months'
                ? event.target.value
                : 'weeks',
          })
        }
      >
        {(Object.keys(ZOOM_LABELS) as TimelineZoom[]).map((z) => (
          <option key={z} value={z}>
            {ZOOM_LABELS[z]}
          </option>
        ))}
      </select>
    </>
  ) : null;

  const trailing = (
    <Button
      kind="tertiary"
      size="small"
      aria-label="Timeline settings"
      aria-expanded={settingsOpen}
      onClick={() => useTimelineUi.getState().setSettingsOpen(uiKey, !settingsOpen)}
    >
      <Settings aria-hidden="true" />
    </Button>
  );

  return (
    <div className={styles.root}>
      <BoardToolbar
        board={board}
        items={items}
        userLookup={lookup}
        variant="timeline"
        canAddItem={canWrite}
        onNewItem={() => void addOnDay(today)}
        after={controls}
        trailing={trailing}
      />
      <div className={styles.main}>
        <div className={styles.column}>
          <div className={styles.scroll} ref={scrollRef} onScroll={onScroll}>
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
              <TimelineGrid
                model={model}
                windows={laneWindows}
                settings={settings}
                paneHidden={paneHidden}
                allCollapsed={allCollapsed}
                canWrite={canWrite}
                isDateColumn={column.def.type !== 'timeline'}
                today={today}
                preview={(bar, kind, k) => {
                  const plan = planDrag(bar, column, model.axis, kind, k);
                  return plan ? dragRangeText(plan.from, plan.to) : dragRangeText(bar.from, bar.to);
                }}
                onToggleAll={toggleAll}
                onToggleLane={toggleLane}
                onTogglePane={() => useTimelineUi.getState().setPaneHidden(uiKey, !paneHidden)}
                onOpen={(id) => openItemFull(boardId, id)}
                onCommit={commit}
              />
            )}
          </div>
          {ready && model.noDates ? (
            <p className={styles.hint}>
              No item has a date in {column.def.title}. Add dates to see them here.
            </p>
          ) : null}
          {ready && settings.showLegend ? <ColorLegend entries={model.legend} /> : null}
        </div>
        {settingsOpen ? (
          <TimelineSettingsPanel
            boardId={boardId}
            timeColumns={timeColumns}
            columns={columns}
            columnId={column?.def.id ?? null}
            settings={settings}
            onClose={() => useTimelineUi.getState().setSettingsOpen(uiKey, false)}
          />
        ) : null}
      </div>
    </div>
  );
}

interface TimelineGridProps {
  model: TimelineModel;
  windows: ReturnType<typeof windowLanes>;
  settings: TimelineViewSettings;
  paneHidden: boolean;
  allCollapsed: boolean;
  canWrite: boolean;
  isDateColumn: boolean;
  today: string;
  preview: (bar: TimelineBar, kind: DragKind, k: number) => string;
  onToggleAll: () => void;
  onToggleLane: (groupId: string) => void;
  onTogglePane: () => void;
  onOpen: (itemId: string) => void;
  onCommit: (bar: TimelineBar, kind: DragKind, k: number) => void;
}

function TimelineGrid({
  model,
  windows,
  settings,
  paneHidden,
  allCollapsed,
  canWrite,
  isDateColumn,
  today,
  preview,
  onToggleAll,
  onToggleLane,
  onTogglePane,
  onOpen,
  onCommit,
}: TimelineGridProps) {
  const { axis, zoom } = model;
  const dayCount = axis.days.length;
  const showWeekendShade = zoom === 'days' && settings.showWeekends;
  const style = {
    '--tl-axis-days': dayCount,
    '--tl-day-width': model.dayWidth,
    '--tl-today-idx': Math.min(model.todayIdx, Math.max(0, dayCount - 1)),
    '--tl-weekend-shift': (weekdayOf(axis.days[0] ?? today) + 6) % 7,
  } as CSSProperties;

  return (
    <div
      className={classNames(styles.content, paneHidden && styles.contentPaneHidden)}
      style={style}
      role="group"
      aria-label="Timeline"
      data-zoom={zoom}
    >
      <div className={styles.headerRow}>
        <div className={styles.corner}>
          {paneHidden ? null : (
            <Button
              kind="tertiary"
              size="small"
              onClick={onToggleAll}
              disabled={model.lanes.length === 0}
              aria-label={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </Button>
          )}
          <Button
            kind="tertiary"
            size="small"
            aria-label={paneHidden ? 'Show group names' : 'Hide group names'}
            aria-pressed={paneHidden}
            onClick={onTogglePane}
          >
            {paneHidden ? (
              <NavigationChevronRight aria-hidden="true" />
            ) : (
              <NavigationChevronLeft aria-hidden="true" />
            )}
          </Button>
        </div>
        <div className={styles.axisHeader}>
          <div className={styles.axisRow}>
            {axis.top.map((cell) => (
              <div
                key={cell.key}
                className={styles.axisTop}
                style={{ '--tl-span': cell.span } as CSSProperties}
              >
                <span className={styles.axisTopLabel}>{cell.label}</span>
              </div>
            ))}
          </div>
          <div className={styles.axisRow}>
            {axis.cells.map((cell) => (
              <div
                key={cell.key}
                className={classNames(
                  styles.axisCell,
                  zoom === 'days' && isWeekend(cell.key) && styles.axisCellWeekend,
                )}
                style={{ '--tl-span': cell.span } as CSSProperties}
                aria-current={cell.today && settings.showToday ? 'date' : undefined}
              >
                <span
                  className={classNames(
                    styles.axisLabel,
                    cell.today && settings.showToday && styles.axisToday,
                  )}
                >
                  {cell.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.body}>
        <div
          className={classNames(
            styles.gridLayer,
            zoom === 'days' && styles.gridDays,
            zoom === 'weeks' && styles.gridWeeks,
            showWeekendShade && styles.gridWeekends,
          )}
          aria-hidden="true"
        />
        {settings.showToday ? (
          <div className={styles.todayLine} data-today="true" aria-hidden="true" />
        ) : null}
        {windows.map((win) => (
          <Lane
            key={win.lane.group.id}
            win={win}
            model={model}
            paneHidden={paneHidden}
            canWrite={canWrite}
            isDateColumn={isDateColumn}
            preview={preview}
            onToggleLane={onToggleLane}
            onOpen={onOpen}
            onCommit={onCommit}
          />
        ))}
      </div>
    </div>
  );
}

interface LaneProps {
  win: ReturnType<typeof windowLanes>[number];
  model: TimelineModel;
  paneHidden: boolean;
  canWrite: boolean;
  isDateColumn: boolean;
  preview: TimelineGridProps['preview'];
  onToggleLane: (groupId: string) => void;
  onOpen: (itemId: string) => void;
  onCommit: TimelineGridProps['onCommit'];
}

function Lane({
  win,
  model,
  paneHidden,
  canWrite,
  isDateColumn,
  preview,
  onToggleLane,
  onOpen,
  onCommit,
}: LaneProps) {
  const lane: TimelineLane = win.lane;
  const { group, summary } = lane;
  const color = group.color;
  return (
    <div
      className={styles.lane}
      style={{ '--tl-rows': lane.heightRows } as CSSProperties}
      data-group={group.id}
    >
      <div className={styles.laneName}>
        {paneHidden ? null : (
          <button
            type="button"
            className={styles.laneButton}
            aria-expanded={!lane.collapsed}
            aria-label={`${group.title}, ${lane.collapsed ? 'collapsed' : 'expanded'}`}
            onClick={() => onToggleLane(group.id)}
          >
            <NavigationChevronDown
              aria-hidden="true"
              className={classNames(styles.laneChevron, lane.collapsed && styles.laneChevronOff)}
            />
            <span className={styles.laneDot} style={{ background: color }} aria-hidden="true" />
            <span className={styles.laneTitle}>{group.title}</span>
          </button>
        )}
      </div>
      <div className={styles.track}>
        {win.render ? (
          <>
            {summary ? (
              <div
                className={styles.summary}
                style={
                  {
                    '--tl-start': summary.startIdx,
                    '--tl-span': Math.max(1, summary.endIdx - summary.startIdx + 1),
                    '--tl-bar-color': color,
                  } as CSSProperties
                }
              >
                <div className={styles.summaryLabel}>
                  <span className={styles.summaryName}>{group.title}</span>
                  <span className={styles.summarySep} aria-hidden="true" />
                  <span>{summary.rangeText}</span>
                  <span className={styles.summarySep} aria-hidden="true" />
                  <span>{summary.daysText}</span>
                </div>
                <div className={styles.summaryLine} />
              </div>
            ) : null}
            {lane.collapsed
              ? null
              : lane.bars
                  .filter((bar) => bar.row >= win.rowFrom && bar.row < win.rowTo)
                  .map((bar) => (
                    <Bar
                      key={bar.key}
                      bar={bar}
                      topRow={lane.summaryRows + bar.row}
                      dayWidth={model.dayWidth}
                      canWrite={canWrite}
                      resizable={canWrite && !isDateColumn}
                      preview={preview}
                      onOpen={onOpen}
                      onCommit={onCommit}
                    />
                  ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

interface BarProps {
  bar: TimelineBar;
  topRow: number;
  dayWidth: number;
  canWrite: boolean;
  resizable: boolean;
  preview: TimelineGridProps['preview'];
  onOpen: (itemId: string) => void;
  onCommit: TimelineGridProps['onCommit'];
}

function Bar({ bar, topRow, dayWidth, canWrite, resizable, preview, onOpen, onCommit }: BarProps) {
  const [drag, setDrag] = useState<{ kind: DragKind; k: number } | null>(null);
  const press = useRef<{
    kind: DragKind;
    x: number;
    moved: boolean;
    el: HTMLElement;
    id: number;
  } | null>(null);
  const suppressClick = useRef(false);

  const begin = (event: PointerEvent<HTMLElement>, kind: DragKind) => {
    if (!canWrite || event.button !== 0) return;
    if (kind !== 'move') event.stopPropagation();
    press.current = {
      kind,
      x: event.clientX,
      moved: false,
      el: event.currentTarget,
      id: event.pointerId,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const track = (event: PointerEvent<HTMLElement>) => {
    const current = press.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    if (!current.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    current.moved = true;
    const k = resolveDrag(bar, current.kind, Math.round(dx / dayWidth)).k;
    setDrag((d) => (d && d.k === k && d.kind === current.kind ? d : { kind: current.kind, k }));
  };
  const finish = (cancelled: boolean) => {
    const current = press.current;
    press.current = null;
    if (!current) return;
    try {
      current.el.releasePointerCapture?.(current.id);
    } catch {
      // The pointer is already gone.
    }
    if (current.moved) {
      // The click that follows a drag must not open the item.
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      const k = drag?.k ?? 0;
      setDrag(null);
      if (!cancelled && k !== 0) onCommit(bar, current.kind, k);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && press.current?.moved) {
      press.current = null;
      setDrag(null);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(bar.item.id);
      return;
    }
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0 || !canWrite) return;
    event.preventDefault();
    // Arrows move the item a day, Shift moves its end, Alt its start.
    const kind: DragKind = event.shiftKey ? 'end' : event.altKey ? 'start' : 'move';
    if (kind !== 'move' && !resizable) return;
    onCommit(bar, kind, step);
  };

  const shown = drag ? resolveDrag(bar, drag.kind, drag.k) : null;
  const startIdx = drag && drag.kind !== 'move' && shown ? shown.startIdx : bar.startIdx;
  const endIdx = drag && drag.kind !== 'move' && shown ? shown.endIdx : bar.endIdx;
  const moving = drag?.kind === 'move' ? drag.k * dayWidth : 0;
  const wrapStyle: CSSProperties = {
    '--tl-start': startIdx,
    '--tl-span': endIdx - startIdx + 1,
    '--tl-row': topRow,
    ...(bar.color ? { '--tl-bar-color': bar.color } : {}),
    ...(moving !== 0 ? { transform: `translate3d(${moving}px, 0, 0)` } : {}),
  } as CSSProperties;

  return (
    <div
      className={classNames(
        styles.bar,
        bar.tone === 'light' ? styles.barLight : styles.barDark,
        bar.labelOutside && styles.barOutside,
        bar.continuesBefore && styles.barContinuesBefore,
        bar.continuesAfter && styles.barContinuesAfter,
        drag && styles.barDragging,
        canWrite && styles.barEditable,
      )}
      style={wrapStyle}
      role="button"
      tabIndex={0}
      aria-label={bar.label}
      aria-roledescription="timeline item"
      aria-description={
        canWrite
          ? resizable
            ? 'Arrow keys move the item by a day, Shift and arrow keys change its end, Alt and arrow keys change its start.'
            : 'Arrow keys move the item by a day.'
          : undefined
      }
      data-item={bar.item.id}
      onClick={() => {
        if (!suppressClick.current) onOpen(bar.item.id);
      }}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => begin(event, 'move')}
      onPointerMove={track}
      onPointerUp={() => finish(false)}
      onPointerCancel={() => finish(true)}
    >
      <span className={styles.barFill}>
        {bar.labelOutside ? null : <span className={styles.barText}>{bar.name}</span>}
      </span>
      {bar.labelOutside ? <span className={styles.barLabel}>{bar.name}</span> : null}
      {resizable && !bar.continuesBefore ? (
        <span
          className={classNames(styles.handle, styles.handleStart)}
          data-handle="start"
          aria-hidden="true"
          onPointerDown={(event) => begin(event, 'start')}
        />
      ) : null}
      {resizable && !bar.continuesAfter ? (
        <span
          className={classNames(styles.handle, styles.handleEnd)}
          data-handle="end"
          aria-hidden="true"
          onPointerDown={(event) => begin(event, 'end')}
        />
      ) : null}
      {drag ? (
        <span className={styles.tooltip} role="status">
          {preview(bar, drag.kind, drag.k)}
        </span>
      ) : null}
    </div>
  );
}
