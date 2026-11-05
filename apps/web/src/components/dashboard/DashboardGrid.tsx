import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core';
import type { DashboardWidget } from '@atrium/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dragClickGuard } from '../Sidebar/dragClickGuard';
import {
  moveItem,
  moveItemBy,
  normalizeLayout,
  resizeItem,
  toGridItems,
  type GridItem,
} from './dashboard-layout';
import { deltaToCells, readGridMetrics } from './grid-metrics';
import styles from './dashboard.module.css';
import { parseHandleId } from './handle-ids';
import { WidgetFrame } from './WidgetFrame';
import { atLeastMinSize } from './widgets/widget-catalog';

/** Pause after the last key press before a keyboard move or resize is saved. */
export const LAYOUT_SAVE_DELAY_MS = 400;

/** A resize to `size`, never below the widget type's minimum. */
function resizeWithMin(
  widgets: readonly DashboardWidget[],
  list: readonly GridItem[],
  id: string,
  size: { w: number; h: number },
): GridItem[] {
  const type = widgets.find((w) => w.id === id)?.type;
  return resizeItem(list, id, type ? atLeastMinSize(type, size) : size);
}

type Gesture =
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'resize'; id: string; dx: number; dy: number };

export interface DashboardGridProps {
  widgets: readonly DashboardWidget[];
  canEdit: boolean;
  /** The widget's content (below the title bar). */
  renderWidget: (widget: DashboardWidget) => ReactNode;
  /** The new layout after a drag, a resize or keyboard moves (saved by the caller). */
  onLayoutChange: (items: GridItem[]) => void;
  onEdit: (widget: DashboardWidget) => void;
  onDuplicate: (widget: DashboardWidget) => void;
  onRemove: (widget: DashboardWidget) => void;
}

/**
 * The widget grid: 12 columns, rows of a fixed height. Widgets move and resize by pointer
 * (dnd-kit; the moved card follows the pointer with a transform and a dashed outline shows where
 * it will land) or by the arrow keys on the title bar (move) and the corner handle (resize); key
 * presses apply at once and are saved together after a short pause. The layout maths is in
 * `dashboard-layout.ts`.
 */
export function DashboardGrid({
  widgets,
  canEdit,
  renderWidget,
  onLayoutChange,
  onEdit,
  onDuplicate,
  onRemove,
}: DashboardGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Keyboard changes show at once; the draft is dropped when the widgets prop changes (a new
  // snapshot), which is when the save has come back.
  const [draft, setDraft] = useState<{
    base: readonly DashboardWidget[];
    items: GridItem[];
  } | null>(null);
  const stored = useMemo(() => normalizeLayout(toGridItems(widgets)), [widgets]);
  const items = draft && draft.base === widgets ? draft.items : stored;

  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<GridItem[] | null>(null);
  const onLayoutChangeRef = useRef(onLayoutChange);
  useEffect(() => {
    onLayoutChangeRef.current = onLayoutChange;
  }, [onLayoutChange]);

  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (pending.current) {
      const next = pending.current;
      pending.current = null;
      onLayoutChangeRef.current(next);
    }
  }, []);
  // Leaving the page saves what is pending.
  useEffect(() => flush, [flush]);

  const scheduleSave = (next: GridItem[]) => {
    setDraft({ base: widgets, items: next });
    pending.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, LAYOUT_SAVE_DELAY_MS);
  };

  const describe = (next: GridItem[], id: string, verb: string) => {
    const item = next.find((i) => i.id === id);
    const widget = widgets.find((w) => w.id === id);
    if (!item || !widget) return;
    setAnnouncement(
      `${widget.title.trim() || 'Widget'} ${verb}: column ${item.x + 1}, row ${item.y + 1}, ${item.w} wide, ${item.h} tall`,
    );
  };

  const keyMove = (id: string, dx: number, dy: number) => {
    const next = moveItemBy(items, id, { dx, dy });
    scheduleSave(next);
    describe(next, id, 'moved to');
  };
  const resizeTo = (list: readonly GridItem[], id: string, size: { w: number; h: number }) =>
    resizeWithMin(widgets, list, id, size);
  const keyResize = (id: string, dw: number, dh: number) => {
    const current = items.find((i) => i.id === id);
    if (!current) return;
    const next = resizeTo(items, id, { w: current.w + dw, h: current.h + dh });
    scheduleSave(next);
    describe(next, id, 'resized to');
  };

  // ---- Pointer gestures ----
  const cellsOf = (event: { delta: { x: number; y: number } }) => {
    const metrics = gridRef.current ? readGridMetrics(gridRef.current) : null;
    return metrics ? deltaToCells(event.delta, metrics) : { dx: 0, dy: 0 };
  };
  const handleDragMove = (event: DragMoveEvent) => {
    const handle = parseHandleId(String(event.active.id));
    if (!handle) return;
    const { dx, dy } = cellsOf(event);
    setGesture((prev) =>
      prev &&
      prev.kind === handle.kind &&
      prev.id === handle.widgetId &&
      prev.dx === dx &&
      prev.dy === dy
        ? prev
        : { kind: handle.kind, id: handle.widgetId, dx, dy },
    );
  };
  const handleDragEnd = (event: DragEndEvent) => {
    dragClickGuard.end();
    setGesture(null);
    const handle = parseHandleId(String(event.active.id));
    if (!handle) return;
    const { dx, dy } = cellsOf(event);
    if (dx === 0 && dy === 0) return;
    const current = items.find((i) => i.id === handle.widgetId);
    if (!current) return;
    const next =
      handle.kind === 'move'
        ? moveItem(items, current.id, { x: current.x + dx, y: current.y + dy })
        : resizeTo(items, current.id, { w: current.w + dx, h: current.h + dy });
    scheduleSave(next);
    describe(next, current.id, handle.kind === 'move' ? 'moved to' : 'resized to');
    flush();
  };

  // What the grid shows during a pointer gesture: the others make room, the dragged card stays
  // under the pointer, and a dashed outline marks the landing cells.
  const preview = useMemo(() => {
    if (!gesture) return null;
    const current = items.find((i) => i.id === gesture.id);
    if (!current) return null;
    return gesture.kind === 'move'
      ? moveItem(items, current.id, { x: current.x + gesture.dx, y: current.y + gesture.dy })
      : resizeWithMin(widgets, items, current.id, {
          w: current.w + gesture.dx,
          h: current.h + gesture.dy,
        });
  }, [gesture, items, widgets]);
  const shown = preview ?? items;
  const landing = gesture ? shown.find((i) => i.id === gesture.id) : undefined;
  const original = (id: string) => items.find((i) => i.id === id)!;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={() => dragClickGuard.start()}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        dragClickGuard.end();
        setGesture(null);
      }}
    >
      <div ref={gridRef} className={styles.grid} role="group" aria-label="Dashboard widgets">
        {landing ? (
          <div
            className={styles.landing}
            aria-hidden="true"
            style={{
              gridColumn: `${landing.x + 1} / span ${landing.w}`,
              gridRow: `${landing.y + 1} / span ${landing.h}`,
            }}
          />
        ) : null}
        {widgets.map((widget) => {
          const isGesture = gesture?.id === widget.id;
          // The widget being dragged keeps its own cells (it follows the pointer); a resized one
          // keeps its size until the pointer is released.
          const item = isGesture
            ? original(widget.id)
            : (shown.find((i) => i.id === widget.id) ?? original(widget.id));
          return (
            <WidgetFrame
              key={widget.id}
              widget={widget}
              position={{ column: item.x + 1, row: item.y + 1, width: item.w, height: item.h }}
              canEdit={canEdit}
              moving={isGesture && gesture.kind === 'move'}
              onMove={(dx, dy) => keyMove(widget.id, dx, dy)}
              onResize={(dw, dh) => keyResize(widget.id, dw, dh)}
              onEdit={() => onEdit(widget)}
              onDuplicate={() => onDuplicate(widget)}
              onRemove={() => onRemove(widget)}
            >
              {renderWidget(widget)}
            </WidgetFrame>
          );
        })}
      </div>
      <div className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </div>
    </DndContext>
  );
}
