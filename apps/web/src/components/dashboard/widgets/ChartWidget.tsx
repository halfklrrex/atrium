import type { ChartSettings } from '@atrium/shared';
import { Loader } from '@vibe/core';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readMetrics, type ChartMetrics } from '../../board-chart/chart-metrics';
import { ChartSvg } from '../../board-chart/ChartSvg';
import { ColorLegend } from '../../board-date-views/DateViewParts';
import styles from '../dashboard.module.css';
import { buildMultiBoardChartModel } from './chart-widget-model';
import type { WidgetDataProps } from './NumbersWidget';

/** What the chart is sized to before it has been measured (and in tests, which have no layout). */
const DEFAULT_SIZE = { width: 480, height: 240 };

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

/** The Chart view's chart over the widget's boards (bar, stacked bar, line, pie or donut). */
export function ChartWidget({
  settings,
  boards,
  loading,
  widgetBoardIds,
  userName,
}: WidgetDataProps & {
  settings: ChartSettings;
  userName: (uid: string) => string | undefined;
}) {
  const model = useMemo(
    () => buildMultiBoardChartModel({ boards, widgetBoardIds, settings, userName }),
    [boards, widgetBoardIds, settings, userName],
  );
  const plottable = model.buckets.some((b) => b.value !== null && b.value !== 0);
  const showPlot = !loading && model.itemCount > 0 && plottable;
  const { ref, size, metrics } = useElementSize(showPlot);

  if (loading) {
    return (
      <div className={styles.widgetNote} role="status">
        <Loader size="small" />
      </div>
    );
  }
  if (model.itemCount === 0) {
    return <div className={styles.widgetNote}>No items to chart yet.</div>;
  }
  if (!plottable) {
    return <div className={styles.widgetNote}>None of the items has a value to chart.</div>;
  }
  return (
    <div className={styles.chartWidget}>
      <div className={styles.chartPlot} ref={ref}>
        <ChartSvg
          model={model}
          width={size.width}
          height={size.height}
          metrics={metrics ?? readMetrics(null)}
          showValues={settings.showValues}
        />
      </div>
      {settings.showLegend ? <ColorLegend entries={model.legend} /> : null}
      {model.yFallback ? <p className={styles.tableNote}>{model.yFallback}</p> : null}
      {model.notes.map((note) => (
        <p key={note} className={styles.tableNote}>
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
    </div>
  );
}
