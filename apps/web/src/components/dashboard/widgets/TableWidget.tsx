import { Loader } from '@vibe/core';
import { useCallback, useMemo, type CSSProperties, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { getColumnUi } from '../../../columns/registry';
import { itemViewPath } from '../../item-view/item-view-store';
import styles from '../dashboard.module.css';
import type { WidgetDataProps } from './NumbersWidget';
import { buildTableModel, type TableCell, type TableRow, type TableSettings } from './table-model';

/** A read-only cell, drawn by the column type's own display. */
function ReadOnlyCell({ cell, row }: { cell: TableCell | null; row: TableRow }) {
  const Cell = cell ? getColumnUi(cell.column.def.type)?.Cell : undefined;
  return (
    <div role="gridcell" className={styles.tableCell}>
      {cell && Cell ? (
        <Cell
          value={cell.value}
          settings={cell.column.settings}
          column={cell.column.def}
          ctx={{
            highlight: '',
            rowDone: row.row.done,
            canEdit: false,
            boardId: row.row.board.id,
            itemId: row.row.item.id,
          }}
          onChange={() => undefined}
        />
      ) : null}
    </div>
  );
}

function Row({ row }: { row: TableRow }) {
  const navigate = useNavigate();
  const path = itemViewPath(row.row.board, row.row.item.id);
  const open = useCallback(
    (event: MouseEvent) => {
      // The name link handles its own click, so ctrl/cmd-click still opens a new tab.
      if (event.defaultPrevented) return;
      void navigate(path);
    },
    [navigate, path],
  );
  return (
    <div role="row" className={styles.tableRow} onClick={open}>
      <div role="gridcell" className={styles.tableName}>
        <Link to={path} className={styles.tableLink} title={row.row.item.name}>
          {row.row.item.name}
        </Link>
      </div>
      <div role="gridcell" className={styles.tableBoard} title={row.row.board.name}>
        {row.row.board.name}
      </div>
      {row.cells.map((cell, i) => (
        <ReadOnlyCell key={i} cell={cell} row={row} />
      ))}
    </div>
  );
}

/** A scrollable, filtered list of items from the dashboard's boards. */
export function TableWidget({
  settings,
  boards,
  loading,
  widgetBoardIds,
}: WidgetDataProps & { settings: TableSettings }) {
  const model = useMemo(
    () => buildTableModel({ boards, widgetBoardIds, settings }),
    [boards, widgetBoardIds, settings],
  );
  if (loading) {
    return (
      <div className={styles.widgetNote} role="status">
        <Loader size="small" />
      </div>
    );
  }
  if (model.total === 0) {
    return <div className={styles.widgetNote}>No items match.</div>;
  }
  const columns = `minmax(0, 2fr) minmax(0, 1.5fr) repeat(${model.headers.length}, minmax(0, 1fr))`;
  return (
    <div className={styles.tableWidget}>
      <div className={styles.tableScroll}>
        <div
          role="grid"
          aria-label={model.summary}
          className={styles.table}
          style={{ '--table-columns': columns } as CSSProperties}
        >
          <div role="row" className={styles.tableHeaderRow}>
            {['Item', 'Board', ...model.headers].map((title, i) => (
              <div key={`${title}-${i}`} role="columnheader" className={styles.tableHeaderCell}>
                {title}
              </div>
            ))}
          </div>
          {model.rows.map((row) => (
            <Row key={row.key} row={row} />
          ))}
        </div>
      </div>
      {model.note ? (
        <p className={styles.tableNote} role="status">
          {model.note}
        </p>
      ) : null}
    </div>
  );
}
