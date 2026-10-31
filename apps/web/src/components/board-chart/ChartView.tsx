import { Button, Loader } from '@vibe/core';
import { Settings } from '@vibe/icons';
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useItems, useUserLookup, type BoardDoc } from '../../data';
import { useActiveViewId, useBoardFilter, useViewTypeSettings, viewKey } from '../board-filters';
import { ColorLegend } from '../board-date-views/DateViewParts';
import { BoardToolbar } from '../board-table/BoardToolbar';
import { buildColumnViews } from '../board-table/table-model';
import { useTableStore } from '../board-table/table-store';
import { useDeepStable } from '../board-table/useDeepStable';
import { EmptyState } from '../EmptyState/EmptyState';
import { ChartSettingsPanel } from './ChartSettingsPanel';
import { readMetrics, type ChartMetrics } from './chart-metrics';
import { ChartSvg } from './ChartSvg';
import { buildChartModel } from './chart-model';
import { useChartUi } from './chart-store';
import styles from './chart.module.css';

/** What the chart is sized to before it has been measured (and in tests, which have no layout). */
const DEFAULT_SIZE = { width: 640, height: 320 };

/** The size of an element, kept current with a ResizeObserver, and the chart tokens read off it. */
function useElementSize(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [metrics, setMetrics] = useState<ChartMetrics | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) return undefined;
    setMetrics(readMetrics(element));
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width > 0 && height > 0) {
        setSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  return { ref, size, metrics };
}

export interface ChartViewProps {
  board: BoardDoc;
}

/** The Chart view: toolbar, a chart card with a legend, and the settings panel. */
export function ChartView({ board }: ChartViewProps) {
  const { data: items, loading, error } = useItems(board.id);
  const memberLookup = useUserLookup(board.workspaceId);
  const boardId = board.id;
  const viewId = useActiveViewId(boardId);
  const uiKey = viewKey(boardId, viewId);

  const userName = useMemo(
    () => (targetUid: string) => memberLookup(targetUid)?.name,
    [memberLookup],
  );

  // Search is per session: a fresh board starts without it.
  useEffect(() => {
    useTableStore.getState().reset(boardId);
  }, [boardId]);

  const columnDefs = useDeepStable(board.columns);
  const groupDefs = useDeepStable(board.groups);
  const columns = useMemo(() => buildColumnViews(columnDefs), [columnDefs]);
  const settings = useViewTypeSettings(boardId, 'chart');
  const { filterState } = useBoardFilter(boardId);
  const search = useDeferredValue(useTableStore((s) => s.search)).trim();
  const settingsOpen = useChartUi((s) => s.settingsOpen[uiKey] ?? false);

  const model = useMemo(
    () =>
      buildChartModel({
        items,
        columns,
        groups: groupDefs,
        settings,
        filterState,
        search,
        userName,
      }),
    [items, columns, groupDefs, settings, filterState, search, userName],
  );

  const plottable = model.buckets.some((b) => b.value !== null && b.value !== 0);
  const showPlot = !loading && !error && model.itemCount > 0 && plottable;
  const { ref: plotRef, size, metrics } = useElementSize(showPlot);

  const trailing = (
    <Button
      kind="tertiary"
      size="small"
      aria-label="Chart settings"
      aria-expanded={settingsOpen}
      onClick={() => useChartUi.getState().setSettingsOpen(uiKey, !settingsOpen)}
    >
      <Settings aria-hidden="true" />
    </Button>
  );

  return (
    <div className={styles.root}>
      <BoardToolbar
        board={board}
        items={items}
        userLookup={userName}
        variant="chart"
        trailing={trailing}
      />
      <div className={styles.main}>
        <div className={styles.column}>
          <div className={styles.card}>
            {loading ? (
              <div className={styles.state} role="status">
                <Loader size="medium" />
              </div>
            ) : error ? (
              <p className={styles.state} role="alert">
                Could not load the items. Check your connection and try again.
              </p>
            ) : model.itemCount === 0 ? (
              <EmptyState
                size="panel"
                title="No items to chart"
                body="Clear the filters or the search, or add items to this board."
              />
            ) : (
              <>
                <h2 className={styles.title}>{model.title}</h2>
                {plottable ? (
                  <div className={styles.plot} ref={plotRef}>
                    <ChartSvg
                      model={model}
                      width={size.width}
                      height={size.height}
                      metrics={metrics ?? readMetrics(null)}
                      showValues={settings.showValues}
                    />
                  </div>
                ) : (
                  <p className={styles.state}>
                    None of the items has a value to chart. Pick another measure or add values.
                  </p>
                )}
                {settings.showLegend && plottable ? <ColorLegend entries={model.legend} /> : null}
                {model.yFallback ? <p className={styles.hint}>{model.yFallback}</p> : null}
                {model.notes.map((note) => (
                  <p key={note} className={styles.hint}>
                    {note}
                  </p>
                ))}
                <table className={styles.srOnly}>
                  <caption>{model.table.caption}</caption>
                  <thead>
                    <tr>
                      {model.table.head.map((cell, i) => (
                        <th key={`${cell}-${i}`} scope="col">
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {model.table.rows.map((row) => (
                      <tr key={row[0]}>
                        {row.map((cell, i) => (
                          <td key={i}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
        {settingsOpen ? (
          <ChartSettingsPanel
            boardId={boardId}
            columns={columns}
            settings={settings}
            model={model}
            onClose={() => useChartUi.getState().setSettingsOpen(uiKey, false)}
          />
        ) : null}
      </div>
    </div>
  );
}
