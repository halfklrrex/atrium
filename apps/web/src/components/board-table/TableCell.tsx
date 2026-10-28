import { columnRegistry } from '@atrium/shared';
import classNames from 'classnames';
import {
  memo,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from 'react';
import { getColumnUi, type CellContext } from '../../columns/registry';
import type { ItemDoc } from '../../data';
import {
  COLUMN_LOCKED_TOOLTIP,
  SERVER_MANAGED_TOOLTIP,
  canEditColumn,
  derivedCellValue,
} from './derived';
import { tableActions } from './table-actions';
import { useTableEnv } from './table-env';
import type { ColumnView } from './table-model';
import { useTableStore } from './table-store';
import styles from './table.module.css';

interface TableCellProps {
  item: ItemDoc;
  column: ColumnView;
  /** The row's first status is a "done" label. */
  rowDone: boolean;
  highlight: string;
  /** This cell is the active (selected) one. */
  active: boolean;
  /** This cell's editor is open. */
  editing: boolean;
}

/** One value cell: the type's display, plus its editor while it is being edited. */
export const TableCell = memo(function TableCell({
  item,
  column,
  rowDone,
  highlight,
  active,
  editing,
}: TableCellProps) {
  const env = useTableEnv();
  const ref = useRef<HTMLDivElement>(null);
  const ui = getColumnUi(column.def.type);
  const columnId = column.def.id;
  const raw = item.values[columnId];

  const { ctx } = env;
  // Derived cells show a computed value and are read-only: no editor, and nothing is ever written.
  // Server-managed cells (time tracking, files, buttons) show their stored value and are read-only
  // too: only Atrium's Cloud Functions write them.
  // Locked columns are read-only for non-owners (`!canEditColumn`), showing a tooltip on hover.
  const derived = columnRegistry.isDerived(column.def.type);
  const serverManaged = columnRegistry.isServerManaged(column.def.type);
  const effectiveRole =
    ctx.boardRole ?? (env.canManage !== undefined ? (env.canManage ? 'owner' : 'editor') : 'owner');
  const lockedForUser = !canEditColumn(effectiveRole, ctx.board, columnId);
  const canEdit = env.canEdit && !derived && !serverManaged && !lockedForUser;
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

  if (!ui) {
    return <div role="gridcell" className={styles.cell} title={readOnlyTooltip} />;
  }

  const cellContext: CellContext = {
    highlight,
    rowDone,
    canEdit,
    boardId: ctx.boardId,
    itemId,
    canAct: env.canEdit,
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    // Clicks inside a popover editor reach us through the React tree, not through the cell itself.
    if (!event.currentTarget.contains(event.target as Node)) return;
    const store = useTableStore.getState();
    if (!canEdit || ui.editor === 'none') {
      store.setActive({ itemId, columnId });
      return;
    }
    if (ui.editor === 'toggle') {
      store.setActive({ itemId, columnId });
      onChange(ui.toggle?.(value) ?? null);
      return;
    }
    store.setEditing({ itemId, columnId });
  };

  const showEditor = editing && canEdit && (ui.editor === 'inline' || ui.editor === 'popover');
  const Cell = ui.Cell;

  return (
    <div
      ref={ref}
      role="gridcell"
      className={classNames(styles.cell, (active || editing) && styles.cellActive)}
      data-cell={`${itemId}:${columnId}`}
      aria-selected={active || editing}
      title={readOnlyTooltip}
      onClick={onClick}
    >
      {showEditor && ui.editor === 'inline' && ui.Editor ? (
        <CellEditor
          cellRef={ref}
          ui={ui}
          value={value}
          column={column}
          ctx={cellContext}
          onChange={onChange}
          itemId={itemId}
        />
      ) : (
        <Cell
          value={value}
          settings={column.settings}
          column={column.def}
          ctx={cellContext}
          onChange={onChange}
        />
      )}
      {showEditor && ui.editor === 'popover' && ui.Editor ? (
        <CellEditor
          cellRef={ref}
          ui={ui}
          value={value}
          column={column}
          ctx={cellContext}
          onChange={onChange}
          itemId={itemId}
        />
      ) : null}
    </div>
  );
});

/** Mounts the type's editor once the cell element is known (popovers hang from it). */
function CellEditor({
  cellRef,
  ui,
  value,
  column,
  ctx,
  onChange,
  itemId,
}: {
  cellRef: RefObject<HTMLDivElement | null>;
  ui: NonNullable<ReturnType<typeof getColumnUi>>;
  value: unknown;
  column: ColumnView;
  ctx: CellContext;
  onChange: (value: unknown) => void;
  itemId: string;
}) {
  const env = useTableEnv();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setAnchor(cellRef.current), [cellRef]);

  const onClose = useCallback(() => {
    const store = useTableStore.getState();
    // Closing an editor keeps its cell selected, ready for the arrow keys.
    store.setEditing(null);
    store.setActive({ itemId, columnId: column.def.id });
  }, [itemId, column.def.id]);

  const saveSettings = useCallback(
    (settings: unknown) => {
      void tableActions.updateColumn(env.ctx, column.def.id, {
        settings: settings as Record<string, unknown>,
      });
    },
    [env.ctx, column.def.id],
  );

  const Editor = ui.Editor;
  if (!Editor) return null;
  return (
    <Editor
      value={value}
      settings={column.settings}
      column={column.def}
      ctx={ctx}
      anchor={anchor}
      onChange={onChange}
      onClose={onClose}
      saveSettings={saveSettings}
    />
  );
}
