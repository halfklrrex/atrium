import { columnRegistry } from '@atrium/shared';
import classNames from 'classnames';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { getColumnUi, type CellContext } from '../../columns/registry';
import type { ItemDoc } from '../../data';
import {
  COLUMN_LOCKED_TOOLTIP,
  SERVER_MANAGED_TOOLTIP,
  canEditColumn,
  derivedCellValue,
} from '../board-table/derived';
import { tableActions, type TableCtx } from '../board-table/table-actions';
import type { ColumnView } from '../board-table/table-model';
import styles from './ItemView.module.css';

interface ItemCellProps {
  item: ItemDoc;
  column: ColumnView;
  /** The action context of the column list this column belongs to (board or subitem columns). */
  ctx: TableCtx;
  canEdit: boolean;
  className?: string;
}

/**
 * One value cell of the item view: the SAME column UI as the table (`getColumnUi(type).Cell` and
 * `Editor`), written through `tableActions.setCell`. Derived and server-managed columns are
 * read-only and never open an editor. The open-editor state is local to the cell.
 */
export function ItemCell({ item, column, ctx, canEdit: canEditBoard, className }: ItemCellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setAnchor(ref.current), []);

  const ui = getColumnUi(column.def.type);
  const columnId = column.def.id;
  const raw = item.values[columnId];
  const derived = columnRegistry.isDerived(column.def.type);
  const serverManaged = columnRegistry.isServerManaged(column.def.type);
  const effectiveRole = ctx.boardRole ?? 'owner';
  const lockedForUser = !canEditColumn(effectiveRole, ctx.board, columnId);
  const canEdit = canEditBoard && !derived && !serverManaged && !lockedForUser;
  const readOnlyTooltip = serverManaged
    ? SERVER_MANAGED_TOOLTIP
    : lockedForUser
      ? COLUMN_LOCKED_TOOLTIP
      : undefined;

  const value = useMemo(() => {
    if (derived) return derivedCellValue(ctx.boardId, ctx.columns, column.def, item);
    if (raw === null || raw === undefined) return null;
    const parsed = columnRegistry.parseValue(column.def.type, raw);
    return parsed.success ? parsed.data : null;
  }, [derived, ctx.boardId, ctx.columns, column.def, item, raw]);

  const itemId = item.id;
  const onChange = useCallback(
    (next: unknown) => {
      if (canEdit) void tableActions.setCell(ctx, itemId, columnId, next, item);
    },
    [canEdit, ctx, itemId, columnId, item],
  );
  const saveSettings = useCallback(
    (settings: unknown) => {
      void tableActions.updateColumn(ctx, columnId, {
        settings: settings as Record<string, unknown>,
      });
    },
    [ctx, columnId],
  );

  if (!ui) return <div className={classNames(styles.cell, className)} title={readOnlyTooltip} />;

  const cellContext: CellContext = {
    highlight: '',
    rowDone: false,
    canEdit,
    boardId: ctx.boardId,
    itemId,
    canAct: canEditBoard,
  };
  const Cell = ui.Cell;
  const Editor = ui.Editor;

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    // Clicks inside a popover editor reach us through the React tree, not through the cell itself.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (!canEdit || ui.editor === 'none') return;
    if (ui.editor === 'toggle') {
      onChange(ui.toggle?.(value) ?? null);
      return;
    }
    setEditing(true);
  };

  const showEditor =
    editing && canEdit && Editor && (ui.editor === 'inline' || ui.editor === 'popover');
  const editorProps = {
    value,
    settings: column.settings,
    column: column.def,
    ctx: cellContext,
    anchor,
    onChange,
    onClose: () => setEditing(false),
    saveSettings,
  };

  return (
    <div
      ref={ref}
      className={classNames(styles.cell, editing && styles.cellEditing, className)}
      data-cell={`${itemId}:${columnId}`}
      title={readOnlyTooltip}
      onClick={onClick}
    >
      {showEditor && ui.editor === 'inline' ? (
        <Editor {...editorProps} />
      ) : (
        <Cell
          value={value}
          settings={column.settings}
          column={column.def}
          ctx={cellContext}
          onChange={onChange}
        />
      )}
      {showEditor && ui.editor === 'popover' ? <Editor {...editorProps} /> : null}
    </div>
  );
}
