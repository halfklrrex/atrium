import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Add, NavigationChevronLeft } from '@vibe/icons';
import classNames from 'classnames';
import {
  Fragment,
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { ItemDoc } from '../../data';
import { KanbanCard, type KanbanCardProps } from './KanbanCard';
import { KANBAN_VIRTUALIZE_AFTER, laneDropId, type KanbanLane as LaneModel } from './kanban-model';
import styles from './kanban.module.css';

const CARD_HEIGHT_ESTIMATE = 140;
const OVERSCAN = 6;

/** Where a card dragged from another lane would land: next to `itemId`, or at the end. */
export interface DropMarker {
  laneKey: string;
  itemId: string | null;
  edge: 'before' | 'after';
}

export interface KanbanLaneProps {
  lane: LaneModel;
  boardId: string;
  columnDefs: KanbanCardProps['columnDefs'];
  fields: KanbanCardProps['fields'];
  subitemCounts: ReadonlyMap<string, number>;
  /** Why cards can't be dragged (their tooltip), or `null`. */
  dragOff: string | null;
  canEdit: boolean;
  marker: DropMarker | null;
  scrollElement: HTMLElement | null;
  onToggle: (laneKey: string) => void;
  /** Create an item in this lane; resolves when the write is done. */
  onAdd: (lane: LaneModel, name: string) => Promise<void>;
}

/** One lane: a header in the label colour over a grey body holding the cards. */
export const KanbanLane = memo(function KanbanLane(props: KanbanLaneProps) {
  const { lane, onToggle } = props;
  const { setNodeRef, isOver } = useDroppable({
    id: laneDropId(lane.key),
    data: { type: 'lane', laneKey: lane.key },
  });
  const colour = lane.color ? ({ '--lane-color': lane.color } as CSSProperties) : undefined;

  if (lane.collapsed) {
    return (
      <button
        ref={setNodeRef}
        type="button"
        className={styles.collapsed}
        style={{
          ...colour,
          ...(lane.color ? { background: 'var(--lane-color)' } : null),
        }}
        aria-label={`Expand ${lane.title} lane (${lane.items.length})`}
        aria-expanded={false}
        onClick={() => onToggle(lane.key)}
      >
        <span className={styles.collapsedCount}>{lane.items.length}</span>
        <span className={styles.collapsedTitle}>{lane.title}</span>
      </button>
    );
  }

  return (
    <section className={styles.lane} aria-label={lane.title} data-lane={lane.key}>
      <header
        className={styles.laneHeader}
        style={lane.color ? { background: lane.color } : undefined}
      >
        <h3 className={styles.laneTitle} title={lane.title}>
          {lane.title}
        </h3>
        <span className={styles.laneCount}>{lane.items.length}</span>
        <button
          type="button"
          className={styles.collapse}
          aria-label={`Collapse ${lane.title} lane`}
          aria-expanded
          onClick={() => onToggle(lane.key)}
        >
          <NavigationChevronLeft aria-hidden="true" />
        </button>
      </header>
      <div ref={setNodeRef} className={classNames(styles.laneBody, isOver && styles.laneOver)}>
        <LaneCards {...props} />
        {props.canEdit ? <AddItem lane={lane} onAdd={props.onAdd} /> : null}
      </div>
    </section>
  );
});

function LaneCards({
  lane,
  boardId,
  columnDefs,
  fields,
  subitemCounts,
  dragOff,
  canEdit,
  marker,
  scrollElement,
}: KanbanLaneProps) {
  const ids = lane.items.map((i) => i.id);
  const cardFor = (item: ItemDoc) => (
    <KanbanCard
      key={item.id}
      item={item}
      boardId={boardId}
      columnDefs={columnDefs}
      fields={fields}
      subitemCount={subitemCounts.get(item.id) ?? 0}
      laneKey={lane.key}
      dragOff={dragOff}
      canEdit={canEdit}
    />
  );
  const markerFor = (id: string | null, edge: DropMarker['edge']) =>
    marker && marker.laneKey === lane.key && marker.itemId === id && marker.edge === edge ? (
      <div key={`marker-${edge}`} className={styles.marker} aria-hidden="true" />
    ) : null;

  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {lane.items.length > KANBAN_VIRTUALIZE_AFTER ? (
        <VirtualCards items={lane.items} scrollElement={scrollElement} render={cardFor} />
      ) : (
        lane.items.map((item) => (
          <Fragment key={item.id}>
            {markerFor(item.id, 'before')}
            {cardFor(item)}
            {markerFor(item.id, 'after')}
          </Fragment>
        ))
      )}
      {markerFor(null, 'before')}
    </SortableContext>
  );
}

/** Cards of a big lane: only those near the viewport are mounted, in normal flow of the lane. */
function VirtualCards({
  items,
  scrollElement,
  render,
}: {
  items: readonly ItemDoc[];
  scrollElement: HTMLElement | null;
  render: (item: ItemDoc) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);

  // Where the list starts inside the scrolling content; it moves when the board layout changes.
  useLayoutEffect(() => {
    if (!scrollElement || !listRef.current) return;
    const measure = () => {
      const list = listRef.current;
      if (!list) return;
      const top = list.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top;
      setMargin(Math.round(top + scrollElement.scrollTop));
    };
    measure();
    const observer = new ResizeObserver(measure);
    const content = scrollElement.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [scrollElement]);

  // TanStack Virtual returns functions the React Compiler cannot memoise; the lint rule only
  // warns that this component is skipped by the compiler, which is fine here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => CARD_HEIGHT_ESTIMATE,
    overscan: OVERSCAN,
    scrollMargin: margin,
    getItemKey: (index) => items[index]!.id,
  });

  return (
    <div
      ref={listRef}
      className={styles.virtualList}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((virtual) => (
        <div
          key={items[virtual.index]!.id}
          ref={virtualizer.measureElement}
          data-index={virtual.index}
          className={styles.virtualItem}
          style={{ transform: `translateY(${virtual.start - margin}px)` }}
        >
          {render(items[virtual.index]!)}
        </div>
      ))}
    </div>
  );
}

/** "+ Add item": an inline name field; Enter creates the item and keeps the field open. */
function AddItem({
  lane,
  onAdd,
}: {
  lane: LaneModel;
  onAdd: (lane: LaneModel, name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');
    await onAdd(lane, trimmed);
    inputRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setName('');
      setOpen(false);
    }
  };

  return (
    <div className={styles.addItem}>
      {open ? (
        <input
          ref={inputRef}
          className={styles.addInput}
          value={name}
          placeholder="Item name"
          aria-label={`New item in ${lane.title}`}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (name.trim() === '') setOpen(false);
          }}
        />
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setOpen(true)}>
          <Add aria-hidden="true" />
          Add item
        </button>
      )}
    </div>
  );
}
