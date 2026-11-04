/**
 * Pure layout engine for the dashboard grid (P6): a 12-column grid with unlimited rows. No React,
 * no DOM. Every function returns new arrays and never mutates its input.
 *
 * Rules:
 * - A widget's size and position are clamped to the grid (`clampLayout`).
 * - Widgets never overlap. When one is moved or resized (the "pinned" widget) it keeps its place
 *   and the others are pushed down out of its way (`normalizeLayout`).
 * - Widgets fall upwards until they touch another widget or the top (compaction), so the grid has
 *   no vertical gaps. Order of processing is top to bottom, then left to right, so the result is
 *   stable and the same input always gives the same layout.
 */
import {
  DASHBOARD_LIMITS,
  DEFAULT_WIDGET_SIZE,
  type DashboardWidget,
  type DashboardWidgetType,
  type WidgetLayout,
} from '@atrium/shared';

const { gridColumns, widgetMinW, widgetMaxW, widgetMinH, widgetMaxH, maxY } = DASHBOARD_LIMITS;

export const GRID_COLUMNS = gridColumns;

/** A widget's id with its grid rectangle. */
export interface GridItem extends WidgetLayout {
  id: string;
}

const clampInt = (value: number, min: number, max: number): number => {
  const n = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, n));
};

/** Forces a layout inside the grid: size within the widget limits, position within the columns. */
export function clampLayout(layout: WidgetLayout): WidgetLayout {
  const w = clampInt(layout.w, widgetMinW, widgetMaxW);
  const h = clampInt(layout.h, widgetMinH, widgetMaxH);
  const x = clampInt(layout.x, 0, gridColumns - w);
  const y = clampInt(layout.y, 0, maxY);
  return { x, y, w, h };
}

/** True when the two rectangles share at least one cell. */
export function collides(a: WidgetLayout, b: WidgetLayout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Rows the layout occupies (bottom edge of the lowest widget). */
export function layoutHeight(items: readonly WidgetLayout[]): number {
  return items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

/**
 * Clamps every item, resolves overlaps and compacts upwards. The `pinnedId` item (the one being
 * dragged or resized) is placed first and keeps its clamped position; everything else yields to it.
 * The result keeps the input order.
 */
export function normalizeLayout(items: readonly GridItem[], pinnedId?: string | null): GridItem[] {
  const clamped = items.map((item, index) => ({ id: item.id, ...clampLayout(item), index }));
  const pinned = pinnedId ? clamped.find((item) => item.id === pinnedId) : undefined;
  const rest = clamped
    .filter((item) => item !== pinned)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index);

  const placed: GridItem[] = [];
  const resolved = new Map<string, GridItem>();
  if (pinned) {
    const first: GridItem = { id: pinned.id, x: pinned.x, y: pinned.y, w: pinned.w, h: pinned.h };
    placed.push(first);
    resolved.set(first.id, first);
  }

  for (const item of rest) {
    const next: GridItem = { id: item.id, x: item.x, y: item.y, w: item.w, h: item.h };
    // Push down past whatever it overlaps.
    for (;;) {
      const blocker = placed.find((other) => collides(next, other));
      if (!blocker) break;
      next.y = blocker.y + blocker.h;
    }
    // Fall upwards while the row above is free.
    while (next.y > 0 && !placed.some((other) => collides({ ...next, y: next.y - 1 }, other))) {
      next.y -= 1;
    }
    placed.push(next);
    resolved.set(next.id, next);
  }
  return clamped.map((item) => resolved.get(item.id)!);
}

/** The top-left cell of the first free spot (reading order) that fits a `w` x `h` widget. */
export function findFreeSlot(
  items: readonly WidgetLayout[],
  size: { w: number; h: number },
): { x: number; y: number } {
  const { w, h } = clampLayout({ x: 0, y: 0, ...size });
  const bottom = layoutHeight(items);
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + w <= gridColumns; x += 1) {
      if (!items.some((item) => collides({ x, y, w, h }, item))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/** The layout for a new widget of `type`, placed in the first free slot. */
export function newWidgetLayout(
  items: readonly WidgetLayout[],
  type: DashboardWidgetType,
): WidgetLayout {
  const size = DEFAULT_WIDGET_SIZE[type];
  return { ...findFreeSlot(items, size), ...size };
}

/** Moves one widget to a cell; the others make room. */
export function moveItem(
  items: readonly GridItem[],
  id: string,
  to: { x: number; y: number },
): GridItem[] {
  return normalizeLayout(
    items.map((item) => (item.id === id ? { ...item, x: to.x, y: to.y } : item)),
    id,
  );
}

/** Resizes one widget (clamped to the limits and the right edge); the others make room. */
export function resizeItem(
  items: readonly GridItem[],
  id: string,
  size: { w: number; h: number },
): GridItem[] {
  return normalizeLayout(
    items.map((item) => (item.id === id ? { ...item, w: size.w, h: size.h } : item)),
    id,
  );
}

/** Keyboard move: one cell per arrow key press. */
export function moveItemBy(
  items: readonly GridItem[],
  id: string,
  delta: { dx: number; dy: number },
): GridItem[] {
  const current = items.find((item) => item.id === id);
  if (!current) return normalizeLayout(items);
  return moveItem(items, id, { x: current.x + delta.dx, y: current.y + delta.dy });
}

/** Keyboard resize: one cell per arrow key press. */
export function resizeItemBy(
  items: readonly GridItem[],
  id: string,
  delta: { dw: number; dh: number },
): GridItem[] {
  const current = items.find((item) => item.id === id);
  if (!current) return normalizeLayout(items);
  return resizeItem(items, id, { w: current.w + delta.dw, h: current.h + delta.dh });
}

/** Grid items of a widget list. */
export function toGridItems(
  widgets: readonly Pick<DashboardWidget, 'id' | 'layout'>[],
): GridItem[] {
  return widgets.map((widget) => ({ id: widget.id, ...widget.layout }));
}

/** Writes grid items back onto their widgets (matched by id); widgets without an item keep theirs. */
export function applyGridItems<T extends Pick<DashboardWidget, 'id' | 'layout'>>(
  widgets: readonly T[],
  items: readonly GridItem[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return widgets.map((widget) => {
    const item = byId.get(widget.id);
    return item ? { ...widget, layout: { x: item.x, y: item.y, w: item.w, h: item.h } } : widget;
  });
}

/** Normalises the layouts stored on a widget list (clamp, de-overlap, compact). */
export function normalizeWidgets<T extends Pick<DashboardWidget, 'id' | 'layout'>>(
  widgets: readonly T[],
  pinnedId?: string | null,
): T[] {
  return applyGridItems(widgets, normalizeLayout(toGridItems(widgets), pinnedId));
}
