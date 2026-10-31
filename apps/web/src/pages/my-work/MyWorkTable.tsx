import { columnRegistry } from '@atrium/shared';
import { Icon } from '@vibe/core';
import { Board, BoardPrivate, BoardShareable, Subitems } from '@vibe/icons';
import { useCallback, type CSSProperties, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { CollapsibleSection } from '../../components/CollapsibleSection';
import { itemViewPath } from '../../components/item-view/item-view-store';
import { getColumnUi, type CellContext } from '../../columns/registry';
import type { ColumnView } from '../../components/board-table/table-model';
import type { MyWorkBucket, MyWorkRow, MyWorkSection } from './my-work-model';
import styles from './MyWorkTable.module.css';

const BUCKET_CLASS: Record<MyWorkBucket, string | undefined> = {
  past: styles.bucketPast,
  today: styles.bucketToday,
  thisWeek: styles.bucketThisWeek,
  nextWeek: styles.bucketNextWeek,
  later: styles.bucketLater,
  none: styles.bucketNone,
  done: styles.bucketDone,
};

/** A read-only cell of the item, rendered by the column type's own display. */
function ReadOnlyCell({
  row,
  column,
  highlight,
}: {
  row: MyWorkRow;
  column: ColumnView | undefined;
  highlight: string;
}) {
  if (!column) return <div role="gridcell" className={styles.cell} />;
  const ui = getColumnUi(column.def.type);
  const raw = row.item.values[column.def.id];
  const parsed =
    raw === null || raw === undefined ? null : columnRegistry.parseValue(column.def.type, raw);
  const value = parsed?.success ? parsed.data : null;
  const context: CellContext = {
    highlight,
    rowDone: row.done,
    canEdit: false,
    boardId: row.board.id,
    itemId: row.item.id,
  };
  const Cell = ui?.Cell;
  return (
    <div role="gridcell" className={styles.cell}>
      {Cell ? (
        <Cell
          value={value}
          settings={column.settings}
          column={column.def}
          ctx={context}
          onChange={() => undefined}
        />
      ) : null}
    </div>
  );
}

function BoardKindIcon({ kind }: { kind: string }) {
  const icon = kind === 'private' ? BoardPrivate : kind === 'shareable' ? BoardShareable : Board;
  return <Icon icon={icon} size={16} className={styles.boardIcon} />;
}

function Row({ row, highlight }: { row: MyWorkRow; highlight: string }) {
  const navigate = useNavigate();
  const path = itemViewPath(row.board.id, row.item.id);
  const open = useCallback(
    (event: MouseEvent) => {
      // The name link handles its own click (so ctrl/cmd-click still opens a new tab).
      if (event.defaultPrevented) return;
      void navigate(path);
    },
    [navigate, path],
  );
  return (
    <div role="row" className={styles.row} onClick={open}>
      <div role="gridcell" className={styles.nameCell}>
        {row.item.parentItemId ? (
          <Icon icon={Subitems} size={16} className={styles.subitemIcon} />
        ) : null}
        <Link to={path} className={styles.nameLink} title={row.item.name}>
          {row.item.name}
        </Link>
      </div>
      <div role="gridcell" className={styles.boardCell}>
        <BoardKindIcon kind={row.board.kind} />
        <span className={styles.boardText}>
          <span className={styles.boardName}>{row.board.name}</span>
          {row.workspaceName ? (
            <span className={styles.workspaceName}>{row.workspaceName}</span>
          ) : null}
        </span>
      </div>
      <div role="gridcell" className={styles.groupCell}>
        {row.group ? (
          <>
            <span
              className={styles.groupDot}
              style={{ '--group-color': row.group.color } as CSSProperties}
              aria-hidden="true"
            />
            <span className={styles.groupTitle}>{row.group.title}</span>
          </>
        ) : null}
      </div>
      <ReadOnlyCell row={row} column={row.peopleColumn} highlight={highlight} />
      <ReadOnlyCell row={row} column={row.dateColumn} highlight={highlight} />
      <ReadOnlyCell row={row} column={row.statusColumn} highlight={highlight} />
    </div>
  );
}

/** The sections of My Work: one collapsible, read-only table per non-empty bucket. */
export function MyWorkTable({
  sections,
  highlight,
}: {
  sections: readonly MyWorkSection[];
  highlight: string;
}) {
  return (
    <div className={styles.sections}>
      {sections.map((section) => (
        <CollapsibleSection
          key={section.id}
          title={section.title}
          className={BUCKET_CLASS[section.id]}
          defaultOpen={section.id !== 'done'}
          badge={<span className={styles.count}>{section.rows.length}</span>}
        >
          <div className={styles.scroll}>
            <div role="grid" aria-label={section.title} className={styles.table}>
              <div role="row" className={styles.headerRow}>
                {['Item', 'Board', 'Group', 'People', 'Date', 'Status'].map((title) => (
                  <div key={title} role="columnheader" className={styles.headerCell}>
                    {title}
                  </div>
                ))}
              </div>
              {section.rows.map((row) => (
                <Row key={row.key} row={row} highlight={highlight} />
              ))}
            </div>
          </div>
        </CollapsibleSection>
      ))}
    </div>
  );
}
