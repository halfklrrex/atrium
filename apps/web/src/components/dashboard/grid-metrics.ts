/**
 * Pure pointer-to-grid maths for the dashboard grid (P6): how far a drag moved or resized a
 * widget, in whole grid cells. No React, no DOM.
 */
import { DASHBOARD_LIMITS } from '@atrium/shared';

export interface GridMetrics {
  /** Width of the grid container in CSS pixels. */
  width: number;
  /** Space between cells in CSS pixels. */
  gap: number;
  /** Height of one row in CSS pixels. */
  rowHeight: number;
}

/** Pixels from one column start to the next, and from one row start to the next. */
export function cellSteps(metrics: GridMetrics): { x: number; y: number } {
  const columns = DASHBOARD_LIMITS.gridColumns;
  const column = (metrics.width - metrics.gap * (columns - 1)) / columns;
  return { x: column + metrics.gap, y: metrics.rowHeight + metrics.gap };
}

/** A pointer delta in pixels as whole cells (rounded to the nearest). */
export function deltaToCells(
  delta: { x: number; y: number },
  metrics: GridMetrics,
): { dx: number; dy: number } {
  const step = cellSteps(metrics);
  if (!(step.x > 0) || !(step.y > 0)) return { dx: 0, dy: 0 };
  const round = (n: number) => Math.round(n) || 0; // `|| 0` turns -0 into 0
  return { dx: round(delta.x / step.x), dy: round(delta.y / step.y) };
}

/** Reads the metrics from a rendered grid element; `null` where layout is unavailable (tests). */
export function readGridMetrics(element: HTMLElement): GridMetrics | null {
  const styles = getComputedStyle(element);
  const width = element.getBoundingClientRect().width;
  const gap = parseFloat(styles.columnGap);
  const rowHeight = parseFloat(styles.gridAutoRows);
  if (![width, gap, rowHeight].every((n) => Number.isFinite(n)) || width <= 0) return null;
  return { width, gap, rowHeight };
}
