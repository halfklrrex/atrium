import type { ColumnDef } from '@atrium/shared';
import { Icon } from '@vibe/core';
import { NavigationChevronRight } from '@vibe/icons';
import { getColumnUi, type CellContext } from '../../columns/registry';
import type { ActivityDoc } from '../../data/activity';
import { formatDate, formatRelativeShort } from '../../lib/format';
import { UserAvatar } from '../UserAvatar';
import { activityLabel, activitySentence, isBoardLevel, valueView } from './activity-format';
import styles from './ActivityRow.module.css';

const READ_ONLY_CELL: CellContext = { highlight: '', rowDone: false, canEdit: false };
const noop = () => undefined;

function Value({
  event,
  side,
  columns,
}: {
  event: ActivityDoc;
  side: 'from' | 'to';
  columns: readonly ColumnDef[];
}) {
  const view = valueView(event, side, columns);
  if (view.kind === 'empty') return <span className={styles.empty}>Empty</span>;
  if (view.kind === 'text') return <span className={styles.text}>{view.text}</span>;
  const Cell = getColumnUi(view.column.type)?.Cell;
  if (!Cell)
    return (
      <span className={styles.text}>
        {side === 'from' ? event.data.fromText : event.data.toText}
      </span>
    );
  return (
    <span className={styles.cell}>
      <Cell
        value={view.value}
        settings={view.settings}
        column={view.column}
        ctx={READ_ONLY_CELL}
        onChange={noop}
      />
    </span>
  );
}

function Change({ from, to }: { from: React.ReactNode; to: React.ReactNode }) {
  return (
    <div className={styles.change}>
      {from}
      <Icon icon={NavigationChevronRight} size={16} className={styles.arrow} ignoreFocusStyle />
      {to}
    </div>
  );
}

function Detail({ event, columns }: { event: ActivityDoc; columns: readonly ColumnDef[] }) {
  const { kind, data } = event;
  if (kind === 'value_changed') {
    if (data.more) return <p className={styles.note}>and {data.more} more changes</p>;
    return (
      <Change
        from={<Value event={event} side="from" columns={columns} />}
        to={<Value event={event} side="to" columns={columns} />}
      />
    );
  }
  if (kind === 'item_renamed') {
    return (
      <Change
        from={<span className={styles.text}>{data.fromText}</span>}
        to={<span className={styles.text}>{data.toText}</span>}
      />
    );
  }
  if (kind === 'item_moved') {
    return (
      <Change
        from={<span className={styles.text}>{data.fromGroupTitle ?? 'Another group'}</span>}
        to={<span className={styles.text}>{event.groupTitle ?? 'Another group'}</span>}
      />
    );
  }
  if (kind === 'update_posted' && data.snippet)
    return <p className={styles.note}>{data.snippet}</p>;
  return null;
}

export interface ActivityRowProps {
  event: ActivityDoc;
  /** Columns of the board, to draw values with the column's own cell. */
  columns: readonly ColumnDef[];
  /** Show the item's name (the board panel does; the item card does not). */
  showItem?: boolean;
  /** Opens the item; omitted (no link) for items that no longer exist. */
  onOpenItem?: (itemId: string) => void;
  now?: number;
}

/**
 * One activity entry, as in monday: relative time, the person's avatar, the column title (or what
 * happened), then the old value, an arrow and the new value. Board-level events read as sentences.
 */
export function ActivityRow({
  event,
  columns,
  showItem = false,
  onOpenItem,
  now,
}: ActivityRowProps) {
  const boardLevel = isBoardLevel(event);
  const itemName = event.itemName || 'Untitled item';
  return (
    <li className={styles.row} aria-label={activitySentence(event)}>
      <time
        className={styles.time}
        dateTime={event.createdAt.toDate().toISOString()}
        title={formatDate(event.createdAt)}
      >
        {formatRelativeShort(event.createdAt, now)}
      </time>
      <UserAvatar
        uid={event.actorId}
        name={event.actorName}
        photoURL={event.actorPhotoUrl}
        size="xs"
      />
      <div className={styles.body}>
        {boardLevel ? (
          <p className={styles.sentence}>{activitySentence(event)}</p>
        ) : (
          <>
            <div className={styles.head}>
              {showItem && event.itemId ? (
                onOpenItem ? (
                  <button
                    type="button"
                    className={styles.itemLink}
                    onClick={() => event.itemId && onOpenItem(event.itemId)}
                  >
                    {itemName}
                  </button>
                ) : (
                  <span className={styles.itemName}>{itemName}</span>
                )
              ) : null}
              <span className={styles.label}>{activityLabel(event)}</span>
            </div>
            <Detail event={event} columns={columns} />
          </>
        )}
      </div>
    </li>
  );
}
