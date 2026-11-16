import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Drag } from '@vibe/icons';
import classNames from 'classnames';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import popups from './popups.module.css';

/**
 * Drag-to-reorder wrapper for the label editors. Pointer drag uses dnd-kit; the handle also takes
 * ArrowUp / ArrowDown as the keyboard path, and the editor announces moves through a live region.
 * The dragged preview is drawn in a portal on `document.body`, so a scrolling modal body never clips
 * it. The preview is kept inside the list (vertical axis only), so dragging can't stretch the
 * scroll height, and an explicit drop zone below the last row makes "move to last" easy to hit.
 */
const END_ZONE_ID = '__label-end-zone__';

/** Where a dropped row lands: the id it goes onto, or the last row for the end zone. */
export function dropTargetId(
  ids: readonly (string | number)[],
  overId: string | number,
): string | number | undefined {
  return overId === END_ZONE_ID ? ids[ids.length - 1] : overId;
}

function EndZone() {
  const { setNodeRef, isOver } = useDroppable({ id: END_ZONE_ID });
  return (
    <div
      ref={setNodeRef}
      className={classNames(popups.endZone, isOver && popups.endZoneOver)}
      data-testid="label-end-zone"
      aria-hidden="true"
    />
  );
}

export function LabelSortable({
  ids,
  onDragMove,
  renderOverlay,
  children,
}: {
  ids: readonly (string | number)[];
  onDragMove: (id: string | number, overId: string | number) => void;
  /** The dragged row's preview (its swatch and name). */
  renderOverlay?: (id: string | number) => ReactNode;
  children: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The list's box when the drag began: dnd-kit's transform is relative to that moment (it already
  // folds in any scrolling since), so the bounds must not move with the scrolling body.
  const startRect = useRef<DOMRect | null>(null);
  const keepInList: Modifier = ({ transform, draggingNodeRect }) => {
    const list = startRect.current ?? listRef.current?.getBoundingClientRect();
    if (!list || !draggingNodeRect) return { ...transform, x: 0 };
    const min = list.top - draggingNodeRect.top;
    const max = list.bottom - draggingNodeRect.bottom;
    return { ...transform, x: 0, y: Math.max(min, Math.min(max, transform.y)) };
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onDragStart = ({ active }: DragStartEvent) => {
    startRect.current = listRef.current?.getBoundingClientRect() ?? null;
    setActiveId(active.id);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    startRect.current = null;
    if (!over) return;
    const target = dropTargetId(ids, over.id);
    if (target !== undefined && active.id !== target) onDragMove(active.id, target);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[keepInList]}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        startRect.current = null;
        setActiveId(null);
      }}
    >
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        <div ref={listRef} className={popups.sortableList}>
          {children}
          <EndZone />
        </div>
      </SortableContext>
      {renderOverlay
        ? createPortal(
            <DragOverlay dropAnimation={null}>
              {activeId !== null ? (
                <div className={popups.dragPreview}>{renderOverlay(activeId)}</div>
              ) : null}
            </DragOverlay>,
            document.body,
          )
        : null}
    </DndContext>
  );
}

export function SortableLabelRow({
  id,
  name,
  onMove,
  children,
}: {
  id: string | number;
  name: string;
  onMove: (delta: -1 | 1) => void;
  children: ReactNode;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    onMove(event.key === 'ArrowUp' ? -1 : 1);
  };
  return (
    <div
      ref={setNodeRef}
      className={classNames(popups.sortableRow, isDragging && popups.sortableDragging)}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        type="button"
        className={popups.dragHandle}
        aria-label={`Reorder ${name || 'label'}`}
        title="Drag, or press the up and down arrow keys, to reorder"
        {...attributes}
        {...listeners}
        onKeyDown={onKeyDown}
      >
        <Drag aria-hidden="true" />
      </button>
      <div className={popups.sortableBody}>{children}</div>
    </div>
  );
}

/** Screen-reader announcement text for a move. */
export function moveAnnouncement(name: string, position: number, total: number): string {
  return `${name || 'Label'} moved to position ${position} of ${total}`;
}
