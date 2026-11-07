import { columnRegistry } from '@atrium/shared';
import classNames from 'classnames';
import {
  memo,
  useCallback,
  useEffect,
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
  COLUMN_MIGRATING_TOOLTIP,
  SERVER_MANAGED_TOOLTIP,
  canEditColumn,
  derivedCellValue,
} from './derived';
import { CellSpinner } from './CellSpinner';
import { bulkPeers, isBulkEditableType } from './bulk-edit';
import { REQUIRED_HINT, isRequiredEmpty } from './required';
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
  // A column whose type is being changed is read-only until the Cloud Function finishes.
  const migrating = !!column.def.migrating;
  const canEdit = env.canEdit && !derived && !serverManaged && !lockedForUser && !migrating;
  const readOnlyTooltip = migrating
    ? COLUMN_MIGRATING_TOOLTIP
    : serverManaged
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
  // Bulk edit: outline this column in every selected row while one of its cells is hovered or
  // being edited. A narrow boolean selector: only the cells of that column re-render.
  const bulkOutlined = useTableStore(
    (s) => s.bulkColumnId === columnId && s.selected.has(itemId) && s.selected.size >= 2,
  );
  // True while the pointer is over this cell (or its editor is open): who may clear the outline.
  const ownsOutline = useRef(false);
  const showBulkOutline = () => {
    const store = useTableStore.getState();
    if (!canEdit || !isBulkEditableType(column.def.type) || !store.selected.has(itemId)) return;
    if (store.selected.size < 2) return;
    if (bulkPeers(ctx.getItems?.() ?? env.getItems(), store.selected, item).length === 0) return;
    ownsOutline.current = true;
    store.setBulkColumn(columnId);
  };
  const startBulkHover = () => {
    // Another cell's editor is open: the outline stays where it is.
    if (useTableStore.getState().editing) return;
    showBulkOutline();
  };
  const endBulkHover = () => {
    const store = useTableStore.getState();
    ownsOutline.current = false;
    // While an editor of this column is open the outline stays, even if the pointer leaves.
    if (store.bulkColumnId === columnId && store.editing?.columnId !== columnId) {
      store.setBulkColumn(null);
    }
  };
  // The editor opening (re)starts the outline; only a true-to-false change ends it, so a cell that
  // merely mounts (virtualisation, a new row, an expanded group) never touches another cell's.
  const wasEditing = useRef(false);
  useEffect(() => {
    const was = wasEditing.current;
    wasEditing.current = editing;
    if (editing) showBulkOutline();
    else if (was) {
      ownsOutline.current = false;
      const store = useTableStore.getState();
      if (store.bulkColumnId === columnId && !ref.current?.matches(':hover')) {
        store.setBulkColumn(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the editor opening/closing only
  }, [editing]);
  // The cell that owns the outline unmounting (row deleted, filtered, scrolled away) fires no
  // pointerleave: clear it here so the outline does not get stuck.
  useEffect(
    () => () => {
      const store = useTableStore.getState();
      if (ownsOutline.current && store.bulkColumnId === columnId) store.setBulkColumn(null);
    },
    [columnId],
  );
  const onChange = useCallback(
    (next: unknown) => {
      if (!canEdit) return;
      // Bulk edit: in a selected row, with other rows of its level selected, the change applies to
      // all of them at once (the edited row included, in the same batch).
      const store = useTableStore.getState();
      if (isBulkEditableType(column.def.type) && store.selected.has(itemId)) {
        const peers = bulkPeers(ctx.getItems?.() ?? env.getItems(), store.selected, item);
        if (peers.length > 0) {
          void tableActions.setCellBulk(ctx, item, columnId, next, peers);
          return;
        }
      }
      void tableActions.setCell(ctx, itemId, columnId, next, item);
    },
    [canEdit, ctx, env, itemId, columnId, item, column.def.type],
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
    getItems: env.getItems,
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
      className={classNames(
        styles.cell,
        (active || editing) && styles.cellActive,
        bulkOutlined && styles.cellBulk,
      )}
      data-cell={`${itemId}:${columnId}`}
      aria-selected={active || editing}
      title={readOnlyTooltip}
      data-bulk-outlined={bulkOutlined ? 'true' : undefined}
      aria-description={bulkOutlined ? 'Changes the selected items' : undefined}
      onClick={onClick}
      onPointerEnter={startBulkHover}
      onPointerLeave={endBulkHover}
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
      {!showEditor && isRequiredEmpty(column.def, raw) ? (
        <span className={styles.requiredHint} data-testid={`required-hint-${itemId}:${columnId}`}>
          {REQUIRED_HINT}
        </span>
      ) : null}
      {migrating ? <CellSpinner /> : null}
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
