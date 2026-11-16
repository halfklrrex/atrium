import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Drag } from '@vibe/icons';
import classNames from 'classnames';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import popups from './popups.module.css';

/**
 * Drag-to-reorder wrapper for the label editors. Pointer drag uses dnd-kit; the handle also takes
 * ArrowUp / ArrowDown as the keyboard path, and the editor announces moves through a live region.
 * The dragged preview is drawn in a portal on `document.body`, so the editor's scrolling list
 * (which clips its rows) never cuts it off.
 */
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onDragStart = ({ active }: DragStartEvent) => setActiveId(active.id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (over && active.id !== over.id) onDragMove(active.id, over.id);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        {children}
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
