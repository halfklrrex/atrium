import classNames from 'classnames';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LaneWindow, TimelineModel } from '../board-timeline/timeline-model';
import { arrowShape, barBox } from './gantt-geometry';
import { buildEdges, criticalPath, visibleEdges } from './gantt-model';
import styles from './gantt.module.css';

const DEFAULT_ROW_HEIGHT = 32;

export interface GanttArrowsProps {
  model: TimelineModel;
  windows: readonly LaneWindow[];
  /** The Dependency column whose prerequisites are drawn; null draws nothing. */
  dependencyColumnId: string | null;
  /** Highlight the longest chain: stronger bar outlines and accent arrows. */
  showCriticalPath?: boolean;
}

/**
 * The dependency arrows: one SVG layer over the lanes, from the end of each prerequisite's bar to
 * the start of its dependent's (finish to start). Violated arrows (the prerequisite ends after the
 * dependent starts) are drawn in the danger colour with a tooltip. Only the lines take the pointer;
 * hovering one highlights both items. The arrows of the critical path take the accent colour.
 */
export function GanttArrows({
  model,
  windows,
  dependencyColumnId,
  showCriticalPath = false,
}: GanttArrowsProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [hover, setHover] = useState<string | null>(null);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const value = parseFloat(
      getComputedStyle(svg).getPropertyValue('--atrium-timeline-row-height'),
    );
    if (Number.isFinite(value) && value > 0) setRowHeight(value);
  }, []);

  const edges = useMemo(() => buildEdges(model, dependencyColumnId), [model, dependencyColumnId]);
  const shown = useMemo(() => visibleEdges(edges, windows), [edges, windows]);

  const critical = useMemo(
    () => (showCriticalPath ? criticalPath(edges) : null),
    [edges, showCriticalPath],
  );

  // The bars of the critical path get a stronger outline (marked from here, like the hover link).
  const criticalKey = critical ? JSON.stringify(critical.ids) : '';
  useEffect(() => {
    const root = svgRef.current?.parentElement;
    if (!root || !criticalKey) return;
    const marked: Element[] = [];
    for (const id of JSON.parse(criticalKey) as string[]) {
      root.querySelectorAll(`[data-item="${id.replace(/["\\]/g, '\\$&')}"]`).forEach((el) => {
        el.setAttribute('data-critical', 'true');
        marked.push(el);
      });
    }
    return () => marked.forEach((el) => el.removeAttribute('data-critical'));
  }, [criticalKey, windows]);

  // Hovering an arrow marks its two bars (they live in the lanes, outside this layer).
  const active = shown.find((e) => e.key === hover) ?? null;
  const fromId = active?.from.id;
  const toId = active?.to.id;
  useEffect(() => {
    const root = svgRef.current?.parentElement;
    if (!root || !fromId || !toId) return;
    const marked: Element[] = [];
    for (const id of [fromId, toId]) {
      root.querySelectorAll(`[data-item="${id.replace(/["\\]/g, '\\$&')}"]`).forEach((el) => {
        el.setAttribute('data-linked', 'true');
        marked.push(el);
      });
    }
    return () => marked.forEach((el) => el.removeAttribute('data-linked'));
  }, [fromId, toId]);

  const width = model.axis.days.length * model.dayWidth;
  const height = model.totalRows * rowHeight;

  return (
    <svg
      ref={svgRef}
      className={styles.arrows}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      data-gantt-arrows={shown.length}
      data-critical-path={critical && critical.ids.length > 0 ? critical.ids.join(',') : undefined}
    >
      {shown.map((edge) => {
        const shape = arrowShape(
          barBox(edge.from.startIdx, edge.from.endIdx, edge.from.row, model.dayWidth, rowHeight),
          barBox(edge.to.startIdx, edge.to.endIdx, edge.to.row, model.dayWidth, rowHeight),
          rowHeight,
        );
        return (
          <g
            key={edge.key}
            className={classNames(
              styles.arrow,
              critical?.edgeKeys.has(edge.key) && styles.arrowCritical,
              edge.violated && styles.arrowViolated,
              hover === edge.key && styles.arrowActive,
            )}
            data-edge={edge.key}
            data-violated={edge.violated ? 'true' : undefined}
            data-critical={critical?.edgeKeys.has(edge.key) ? 'true' : undefined}
          >
            {edge.message ? <title>{edge.message}</title> : null}
            <path className={styles.arrowLine} d={shape.line} />
            <path className={styles.arrowHead} d={shape.head} />
            <path
              className={styles.arrowHit}
              d={shape.line}
              onPointerEnter={() => setHover(edge.key)}
              onPointerLeave={() => setHover((h) => (h === edge.key ? null : h))}
            />
          </g>
        );
      })}
    </svg>
  );
}
