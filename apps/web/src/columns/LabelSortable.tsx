import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Drag } from '@vibe/icons';
import classNames from 'classnames';
import type { KeyboardEvent, ReactNode } from 'react';
import popups from './popups.module.css';

/**
 * Drag-to-reorder wrapper for the label editors. Pointer drag uses dnd-kit; the handle also takes
 * ArrowUp / ArrowDown as the keyboard path, and the editor announces moves through a live region.
 */
export function LabelSortable({
  ids,
  onDragMove,
  children,
}: {
  ids: readonly (string | number)[];
  onDragMove: (id: string | number, overId: string | number) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onDragMove(active.id, over.id);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
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
