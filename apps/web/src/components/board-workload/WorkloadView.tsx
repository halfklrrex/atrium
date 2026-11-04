import { canEditBoard, resolveBoardRole } from '@atrium/shared';
import { Button, Loader } from '@vibe/core';
import { NavigationChevronLeft, NavigationChevronRight, Settings } from '@vibe/icons';
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
} from 'react';
import { useAuth } from '../../auth/auth-context';
import { useItems, useUserLookup, useWorkspace, type BoardDoc } from '../../data';
import { MONTH_NAMES, fullDateLabel, isWeekend, parseIsoDay, todayIso } from '../../lib/date-grid';
import {
  useActiveViewId,
  useBoardFilter,
  useFilterStore,
  useViewTypeSettings,
  viewKey,
} from '../board-filters';
import { DateViewEmpty } from '../board-date-views/DateViewParts';
import { statusColumns } from '../board-date-views/date-view-model';
import { BoardToolbar } from '../board-table/BoardToolbar';
import { openItemFull } from '../board-table/open-item';
import { tableActions, type TableCtx } from '../board-table/table-actions';
import { buildColumnViews } from '../board-table/table-model';
import { useTableStore } from '../board-table/table-store';
import { useDeepStable } from '../board-table/useDeepStable';
import { useItemViewStore } from '../item-view/item-view-store';
import { useTimelineUi } from '../board-timeline/timeline-store';
import type { TimelineZoom } from '../board-timeline/timeline-model';
import tl from '../board-timeline/timeline.module.css';
import { WorkloadCell } from './WorkloadCell';
import { WorkloadSettingsPanel } from './WorkloadSettingsPanel';
import {
  UNASSIGNED_ID,
  buildWorkload,
  formatAmount,
  resolveWorkloadColumns,
  unitOf,
  type WorkloadModel,
} from './workload-model';
import styles from './workload.module.css';

const ZOOM_LABELS: Record<TimelineZoom, string> = {
  days: 'Days',
  weeks: 'Weeks',
  months: 'Months',
};

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A token's pixel value from the computed style (fallback outside a browser). */
function readPx(element: HTMLElement, name: string, fallback: number): number {
  const value = parseFloat(getComputedStyle(element).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/** "Mon, Oct 26", "Week W43 19 - 25" or "October 2026": the period a cell stands for. */
function periodTitle(zoom: TimelineZoom, key: string, label: string): string {
  if (zoom === 'days') return fullDateLabel(key);
  if (zoom === 'weeks') return `Week ${label}`;
  return `${MONTH_NAMES[parseIsoDay(`${key}-01`).getUTCMonth()]} ${key.slice(0, 4)}`;
}

/** The Workload view: one row per person, one cell per period, how loaded each person is. */
export function WorkloadView({ board }: { board: BoardDoc }) {
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
  const nameOf = useCallback(
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
  const settings = useViewTypeSettings(boardId, 'workload');
  const resolved = useMemo(() => resolveWorkloadColumns(columns, settings), [columns, settings]);
  const statusColumn = useMemo(() => statusColumns(columns)[0] ?? null, [columns]);

  const { filterState } = useBoardFilter(boardId);
  const search = useDeferredValue(useTableStore((s) => s.search)).trim();
  const today = useMemo(() => todayIso(), []);
  const settingsOpen = useTimelineUi((s) => s.settingsOpen[uiKey] ?? false);
  const paneHidden = useTimelineUi((s) => s.paneHidden[uiKey] ?? false);
  const [openCell, setOpenCell] = useState<string | null>(null);

  const model = useMemo<WorkloadModel | null>(
    () =>
      resolved.dateColumn
        ? buildWorkload({
            items,
            columns,
            dateColumn: resolved.dateColumn,
            peopleColumn: resolved.peopleColumn,
            sumColumn: resolved.sumColumn,
            filterState,
            search,
            settings,
            today,
            nameOf,
          })
        : null,
    [items, columns, resolved, filterState, search, settings, today, nameOf],
  );

  // The full item view steps through the items shown here, person by person.
  const visibleIds = useMemo(
    () =>
      model
        ? model.rows.map((row) => ({
            groupId: row.id,
            ids: [...new Set(row.cells.flatMap((c) => c.entries.map((e) => e.item.id)))],
          }))
        : [],
    [model],
  );
  useEffect(() => {
    useItemViewStore.getState().setVisible(boardId, visibleIds);
  }, [boardId, visibleIds]);

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });
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

  // ---- Scrolling: remember the position per view, centre today the first time and on zoom.
  const scrollRef = useRef<HTMLDivElement>(null);
  const ready = !loading && !error && !!model && !!resolved.dateColumn;
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

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    useTimelineUi.getState().setScroll(uiKey, { left: element.scrollLeft, top: element.scrollTop });
  };

  const controls = ready ? (
    <>
      <span className={tl.divider} role="separator" aria-orientation="vertical" />
      <Button kind="secondary" size="small" onClick={() => centreOnToday(true)}>
        Today
      </Button>
      <select
        className={tl.zoomSelect}
        aria-label="Workload zoom"
        value={settings.zoom}
        onChange={(event) =>
          useFilterStore.getState().setTypeSettings(boardId, 'workload', {
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
      aria-label="Workload settings"
      aria-expanded={settingsOpen}
      onClick={() => useTimelineUi.getState().setSettingsOpen(uiKey, !settingsOpen)}
    >
      <Settings aria-hidden="true" />
    </Button>
  );

  const unit = unitOf(model?.measure === 'sum' ? resolved.sumColumn : null);

  return (
    <div className={tl.root}>
      <BoardToolbar
        board={board}
        items={items}
        userLookup={nameOf}
        variant="workload"
        canAddItem={false}
        after={controls}
        trailing={trailing}
      />
      <div className={tl.main}>
        <div className={tl.column}>
          <div className={tl.scroll} ref={scrollRef} onScroll={onScroll}>
            {loading ? (
              <div className={tl.empty} role="status">
                <Loader size="medium" />
              </div>
            ) : error ? (
              <p className={tl.empty} role="alert">
                Could not load the items. Check your connection and try again.
              </p>
            ) : !model || !resolved.dateColumn ? (
              <DateViewEmpty
                canEdit={canEdit}
                onAddColumn={(type) => void tableActions.addColumn(ctx, type)}
              />
            ) : (
              <div
                className={classNames(tl.content, paneHidden && tl.contentPaneHidden)}
                style={
                  {
                    '--tl-axis-days': model.axis.days.length,
                    '--tl-day-width': model.dayWidth,
                    '--tl-today-idx': model.todayIdx,
                  } as CSSProperties
                }
                role="grid"
                aria-label="Workload"
                data-zoom={model.zoom}
              >
                <div className={tl.headerRow} role="row">
                  <div className={tl.corner} role="columnheader">
                    <span className={styles.cornerTitle}>{paneHidden ? '' : 'People'}</span>
                    <Button
                      kind="tertiary"
                      size="small"
                      aria-label={paneHidden ? 'Show people names' : 'Hide people names'}
                      aria-pressed={paneHidden}
                      onClick={() => useTimelineUi.getState().setPaneHidden(uiKey, !paneHidden)}
                    >
                      {paneHidden ? (
                        <NavigationChevronRight aria-hidden="true" />
                      ) : (
                        <NavigationChevronLeft aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                  <div className={tl.axisHeader}>
                    <div className={tl.axisRow}>
                      {model.axis.top.map((cell) => (
                        <div
                          key={cell.key}
                          className={tl.axisTop}
                          style={{ '--tl-span': cell.span } as CSSProperties}
                        >
                          <span className={tl.axisTopLabel}>{cell.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className={tl.axisRow}>
                      {model.axis.cells.map((cell) => (
                        <div
                          key={cell.key}
                          className={classNames(
                            tl.axisCell,
                            model.zoom === 'days' && isWeekend(cell.key) && tl.axisCellWeekend,
                          )}
                          style={{ '--tl-span': cell.span } as CSSProperties}
                          aria-current={cell.today && settings.showToday ? 'date' : undefined}
                        >
                          <span
                            className={classNames(
                              tl.axisLabel,
                              cell.today && settings.showToday && tl.axisToday,
                            )}
                          >
                            {cell.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className={tl.body}>
                  {model.rows.map((row) => (
                    <div key={row.id} className={styles.row} role="row" data-person={row.id}>
                      <div className={styles.person} role="rowheader">
                        {paneHidden ? null : (
                          <>
                            <span
                              className={classNames(
                                styles.personName,
                                row.id === UNASSIGNED_ID && styles.personUnassigned,
                              )}
                              title={row.name}
                            >
                              {row.name}
                            </span>
                            <span className={styles.personMeta}>
                              {row.itemCount} {row.itemCount === 1 ? 'item' : 'items'}
                              {row.total > 0
                                ? `, ${formatAmount(row.total)}${model.measure === 'sum' ? unit : ' item-days'}`
                                : ''}
                              {row.overCapacity ? (
                                <span className={styles.personOver}> Over capacity</span>
                              ) : null}
                            </span>
                          </>
                        )}
                      </div>
                      {row.cells.map((cell) => {
                        const key = `${row.id}:${cell.key}`;
                        return (
                          <WorkloadCell
                            key={key}
                            cell={cell}
                            personName={row.name}
                            period={periodTitle(model.zoom, cell.key, cell.label)}
                            measure={model.measure}
                            unit={unit}
                            statusColumn={statusColumn}
                            showToday={settings.showToday}
                            open={openCell === key}
                            onOpenChange={(open) => setOpenCell(open ? key : null)}
                            onOpenItem={(id) => {
                              setOpenCell(null);
                              openItemFull(boardId, id);
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                  {model.rows.length === 0 ? (
                    <p className={styles.noRows}>
                      {items.length === 0
                        ? 'This board has no items yet.'
                        : 'No item matches the filters.'}
                    </p>
                  ) : null}
                  {settings.showToday ? (
                    <div className={tl.todayLine} data-today="true" aria-hidden="true" />
                  ) : null}
                </div>
              </div>
            )}
          </div>
          {ready && model.noItemsDated && model.rows.length > 0 ? (
            <p className={tl.hint}>
              No item has a date in {resolved.dateColumn?.def.title}. Add dates to see them here.
            </p>
          ) : null}
          {ready && model.noDates.length > 0 ? (
            <section className={styles.noDates} aria-label="No dates">
              <span className={styles.noDatesTitle}>No dates ({model.noDates.length})</span>
              <ul className={styles.noDatesList}>
                {model.noDates.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={styles.noDatesItem}
                      onClick={() => openItemFull(boardId, item.id)}
                    >
                      {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        {settingsOpen ? (
          <WorkloadSettingsPanel
            boardId={boardId}
            columns={columns}
            resolved={resolved}
            measure={model?.measure ?? 'count'}
            settings={settings}
            onClose={() => useTimelineUi.getState().setSettingsOpen(uiKey, false)}
          />
        ) : null}
      </div>
    </div>
  );
}
