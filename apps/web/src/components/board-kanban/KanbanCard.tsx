import {
  columnRegistry,
  findStatusLabel,
  type ColumnDef,
  type StatusSettings,
  type StatusValue,
} from '@atrium/shared';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from '@vibe/core';
import { AddUpdate, Subitems, Update } from '@vibe/icons';
import classNames from 'classnames';
import { memo, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { getColumnUi } from '../../columns/registry';
import type { ItemDoc } from '../../data';
import { derivedCellValue } from '../board-table/derived';
import { openItem, openItemFull } from '../board-table/open-item';
import type { ColumnView } from '../board-table/table-model';
import { isEmptyFieldValue } from './kanban-model';
import styles from './kanban.module.css';

/** Types shown as plain text on a card (two lines at most, then an ellipsis). */
const TEXT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'long_text',
  'email',
  'phone',
  'auto_number',
  'item_id',
]);

export interface KanbanCardProps {
  item: ItemDoc;
  boardId: string;
  /** Every board column def (derived values read their siblings). */
  columnDefs: readonly ColumnDef[];
  /** The columns shown on the card, in order. */
  fields: readonly ColumnView[];
  subitemCount: number;
  /** The lane this card is in (a drag handle needs it). */
  laneKey: string;
  /** Why the card can't be dragged (shown as its tooltip), or `null` when it can. */
  dragOff: string | null;
  canEdit: boolean;
}

/** One card in a lane: sortable, click opens the full item. */
export const KanbanCard = memo(function KanbanCard(props: KanbanCardProps) {
  const { item, laneKey, dragOff } = props;
  const sortable = useSortable({
    id: item.id,
    data: { type: 'card', laneKey },
    disabled: dragOff !== null,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <CardBody
      {...props}
      cardRef={sortable.setNodeRef}
      style={style}
      dragging={sortable.isDragging}
      dragProps={{ ...sortable.attributes, ...sortable.listeners }}
    />
  );
});

interface CardBodyProps extends KanbanCardProps {
  cardRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  dragging?: boolean;
  dragProps?: Record<string, unknown>;
  overlay?: boolean;
}

/** The card itself, also what the drag overlay shows. */
export function CardBody({
  item,
  boardId,
  columnDefs,
  fields,
  subitemCount,
  dragOff,
  cardRef,
  style,
  dragging,
  dragProps,
  overlay,
}: CardBodyProps) {
  const updatesCount = item.updatesCount ?? 0;
  const open = () => openItemFull(boardId, item.id);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Space starts a keyboard drag (dnd-kit); Enter opens the item.
    if (event.key === 'Enter' && event.target === event.currentTarget && !dragging) {
      event.preventDefault();
      open();
    }
  };
  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div
      {...dragProps}
      ref={cardRef}
      style={style}
      className={classNames(
        styles.card,
        dragging && styles.cardDragging,
        overlay && styles.cardOverlay,
      )}
      role="button"
      tabIndex={0}
      aria-label={item.name}
      aria-roledescription="card"
      title={dragOff || undefined}
      data-card={item.id}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <p className={styles.cardTitle}>{item.name}</p>
      {fields.map((column) => (
        <CardField
          key={column.def.id}
          item={item}
          column={column}
          boardId={boardId}
          columnDefs={columnDefs}
        />
      ))}
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.footerButton}
          aria-label={
            updatesCount > 0
              ? `Updates for ${item.name} (${updatesCount})`
              : `Updates for ${item.name}`
          }
          onClick={(event) => {
            stop(event);
            openItem(boardId, item.id);
          }}
        >
          {updatesCount > 0 ? <span className={styles.footerCount}>{updatesCount}</span> : null}
          {updatesCount > 0 ? <Update aria-hidden="true" /> : <AddUpdate aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={styles.footerButton}
          aria-label={
            subitemCount > 0
              ? `${subitemCount} ${subitemCount === 1 ? 'subitem' : 'subitems'}`
              : 'Subitems'
          }
          onClick={(event) => {
            stop(event);
            open();
          }}
        >
          {subitemCount > 0 ? <span className={styles.footerCount}>{subitemCount}</span> : null}
          <Subitems aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** One field row: the column icon, then the value (the column title is not shown). */
function CardField({
  item,
  column,
  boardId,
  columnDefs,
}: {
  item: ItemDoc;
  column: ColumnView;
  boardId: string;
  columnDefs: readonly ColumnDef[];
}) {
  const { def } = column;
  const ui = getColumnUi(def.type);
  if (!ui) return null;

  let value: unknown;
  if (columnRegistry.isDerived(def.type)) {
    value = derivedCellValue(boardId, columnDefs, def, item);
  } else {
    const raw = item.values[def.id];
    if (raw === null || raw === undefined) return null;
    const parsed = columnRegistry.parseValue(def.type, raw);
    value = parsed.success ? parsed.data : null;
  }
  if (isEmptyFieldValue(value)) return null;

  let content;
  if (def.type === 'status') {
    const label = findStatusLabel(value as StatusValue, column.settings as StatusSettings);
    if (!label || label.label.trim() === '') return null;
    content = (
      <span
        className={styles.statusLabel}
        style={{ '--status-color': label.color } as CSSProperties}
      >
        {label.label}
      </span>
    );
  } else if (def.type === 'link') {
    const link = value as { url: string; text?: string };
    content = (
      // The value was validated by the registry, so `url` is http(s), mailto or tel only.
      <a
        className={styles.fieldLink}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {link.text || link.url}
      </a>
    );
  } else if (TEXT_TYPES.has(def.type)) {
    const text = columnRegistry.toText(def.type, value, column.settings);
    if (!text) return null;
    content = <span className={styles.fieldText}>{text}</span>;
  } else {
    const Cell = ui.Cell;
    content = (
      <div className={styles.fieldCell}>
        <Cell
          value={value}
          settings={column.settings}
          column={def}
          ctx={{ highlight: '', rowDone: false, canEdit: false }}
          onChange={noop}
        />
      </div>
    );
  }

  return (
    <div className={styles.field}>
      <span className={styles.fieldIcon}>
        <Icon icon={ui.icon} size={16} ignoreFocusStyle />
      </span>
      <div className={styles.fieldValue}>{content}</div>
    </div>
  );
}

function noop(): void {
  /* cards are read-only */
}
