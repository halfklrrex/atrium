import type { GroupDef } from '@atrium/shared';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Menu, MenuButton, MenuDivider, MenuItem } from '@vibe/core';
import { Add, Delete, Duplicate, Edit, Settings, SortAscending, SortDescending } from '@vibe/icons';
import classNames from 'classnames';
import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ADD_COLUMN_ORDER, getColumnUi } from '../../columns/registry';
import { columnRegistry } from '@atrium/shared';
import { AnchoredPopup } from './AnchoredPopup';
import { ColumnSettingsPopup } from './ColumnSettings';
import { ConfirmDialog } from './ConfirmDialog';
import { dragProps } from './drag-props';
import { tableActions } from './table-actions';
import { useTableEnv } from './table-env';
import { NAME_COLUMN, SETTINGS_TYPES, type ColumnView } from './table-model';
import { useTableStore } from './table-store';
import { TableCheckbox } from './TableCheckbox';
import { useBoardFilter } from '../board-filters';
import styles from './table.module.css';

const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

interface HeaderRowProps {
  group: GroupDef;
  /** Ids of the items shown in the group: what the header checkbox selects. */
  itemIds: readonly string[];
}

/** Column titles of one group: select-all, the Item header, sortable value headers and "+". */
export function HeaderRow({ group, itemIds }: HeaderRowProps) {
  const env = useTableEnv();
  const { filterState } = useBoardFilter(env.boardId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const selectedCount = useTableStore((s) => {
    let n = 0;
    for (const id of itemIds) if (s.selected.has(id)) n += 1;
    return n;
  });
  // The header of a subitem block (its env is the subitem scope): sort is not offered there, and
  // its column ids must not pick up the sort of a board column with the same id.
  const subitems = env.ctx.scope === 'subitems';
  const sort = subitems
    ? null
    : (filterState.sortConditions.find((s) => s.columnId === 'name' || s.columnId === NAME_COLUMN)
        ?.direction ?? null);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const to = env.columns.findIndex((c) => c.def.id === over.id);
    if (to === -1) return;
    // Same rule as arrayMove: the dragged column takes the target's slot, so `to` is also its index
    // among the other columns (after the target when moving right, before it when moving left).
    void tableActions.reorderColumn(env.ctx, String(active.id), to);
  };

  return (
    <div role="row" className={classNames(styles.headerRow, styles.tinted)}>
      <div
        className={classNames(styles.sticky, styles.headerSticky, styles.tinted)}
        style={{ '--group-color': group.color } as CSSProperties}
      >
        <span className={classNames(styles.bar, styles.barTop)} />
        <div className={classNames(styles.checkCell, styles.headerCheck)} role="columnheader">
          <TableCheckbox
            checked={
              itemIds.length > 0 && selectedCount === itemIds.length
                ? true
                : selectedCount > 0
                  ? 'mixed'
                  : false
            }
            disabled={itemIds.length === 0}
            label={`Select all items in ${group.title}`}
            onChange={(on) => useTableStore.getState().setGroupSelected(itemIds, on)}
          />
        </div>
        <div className={styles.headerName} role="columnheader" aria-sort={ariaSort(sort)}>
          {sort ? (
            <span className={styles.sortIcon}>
              {sort === 'asc' ? <SortAscending /> : <SortDescending />}
            </span>
          ) : null}
          <span className={styles.headerTitle}>{subitems ? 'Subitem' : 'Item'}</span>
          {subitems ? null : <ColumnMenu column={null} group={group} />}
          {subitems ? null : (
            <ResizeHandle columnId={NAME_COLUMN} label="Item" startWidth={env.nameWidth} />
          )}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={env.columns.map((c) => c.def.id)}
          strategy={horizontalListSortingStrategy}
        >
          {env.columns.map((column) => (
            <HeaderCell key={column.def.id} column={column} group={group} />
          ))}
        </SortableContext>
      </DndContext>

      <AddColumnCell group={group} />
    </div>
  );
}

function ariaSort(direction: 'asc' | 'desc' | null) {
  return direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined;
}

function HeaderCell({ column, group }: { column: ColumnView; group: GroupDef }) {
  const env = useTableEnv();
  const columnId = column.def.id;
  const renaming = useTableStore(
    (s) => s.renamingColumn?.groupId === group.id && s.renamingColumn.columnId === columnId,
  );
  const settingsOpen = useTableStore(
    (s) => s.settingsFor?.groupId === group.id && s.settingsFor.columnId === columnId,
  );
  const { filterState } = useBoardFilter(env.boardId);
  const sort =
    env.ctx.scope === 'subitems'
      ? null
      : (filterState.sortConditions.find((s) => s.columnId === columnId)?.direction ?? null);
  const [element, setElement] = useState<HTMLElement | null>(null);

  const sortable = useSortable({ id: columnId, disabled: !env.canEdit || renaming });
  const setRefs = (node: HTMLDivElement | null) => {
    sortable.setNodeRef(node);
    setElement(node);
  };

  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  const finishRename = (title: string) => {
    useTableStore.getState().setRenamingColumn(null);
    const next = title.trim();
    if (next && next !== column.def.title) {
      void tableActions.updateColumn(env.ctx, columnId, { title: next.slice(0, 120) });
    }
  };

  return (
    <div
      ref={setRefs}
      role="columnheader"
      aria-sort={ariaSort(sort)}
      className={classNames(
        styles.headerCell,
        styles.tinted,
        sortable.isDragging && styles.headerDragging,
      )}
      style={style}
      data-column-id={columnId}
    >
      {sort ? (
        <span className={styles.sortIcon}>
          {sort === 'asc' ? <SortAscending /> : <SortDescending />}
        </span>
      ) : null}
      {renaming ? (
        <RenameInput title={column.def.title} onDone={finishRename} />
      ) : (
        <span
          className={classNames(styles.headerTitle, env.canEdit && styles.headerSortable)}
          {...dragProps(sortable)}
          role="presentation"
          tabIndex={-1}
          onDoubleClick={() => {
            if (env.canEdit) {
              useTableStore.getState().setRenamingColumn({ groupId: group.id, columnId });
            }
          }}
        >
          {column.def.title}
        </span>
      )}
      <ColumnMenu column={column} group={group} />
      {env.canEdit ? (
        <ResizeHandle columnId={columnId} label={column.def.title} startWidth={column.width} />
      ) : null}
      {settingsOpen ? <ColumnSettingsPopup column={column} anchor={element} /> : null}
    </div>
  );
}

function RenameInput({ title, onDone }: { title: string; onDone: (title: string) => void }) {
  const [draft, setDraft] = useState(title);
  const [finished, setFinished] = useState(false);
  const finish = (save: boolean) => {
    if (finished) return;
    setFinished(true);
    onDone(save ? draft : title);
  };
  return (
    <input
      className={classNames(styles.addInput, styles.headerInput)}
      value={draft}
      aria-label="Column name"
      maxLength={120}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

/** Drag the right edge of a header to resize its column (saved on release). */
function ResizeHandle({
  columnId,
  label,
  startWidth,
}: {
  columnId: string;
  label: string;
  startWidth: number;
}) {
  const env = useTableEnv();
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const startX = event.clientX;
    let width = startWidth;
    target.setPointerCapture(event.pointerId);
    setDragging(true);

    const move = (e: PointerEvent) => {
      width = startWidth + e.clientX - startX;
      env.onResize(columnId, width, false);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDragging(false);
      env.onResize(columnId, width, true);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      className={classNames(styles.resize, dragging && styles.resizing)}
      onPointerDown={onPointerDown}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

/** The "⋯" menu of a column header (`column` is `null` for the fixed Item column). */
function ColumnMenu({ column, group }: { column: ColumnView | null; group: GroupDef }) {
  const env = useTableEnv();
  const columnId = column?.def.id ?? NAME_COLUMN;
  const title = column?.def.title ?? 'Item';
  const [confirmDelete, setConfirmDelete] = useState(false);
  const store = useTableStore;
  const { filterState, setSortConditions } = useBoardFilter(env.boardId);
  const normCol = columnId === NAME_COLUMN ? 'name' : columnId;
  const subitems = env.ctx.scope === 'subitems';
  const sort = subitems
    ? null
    : (filterState.sortConditions.find((s) => s.columnId === normCol || s.columnId === columnId)
        ?.direction ?? null);
  // Rows this menu's column writes to: top-level items, or the subitems of the block.
  const scopeItems = () => env.getItems().filter((i) => subitems || !i.parentItemId);

  const applySort = (direction: 'asc' | 'desc') => {
    const withoutCol = filterState.sortConditions.filter(
      (s) => s.columnId !== normCol && s.columnId !== columnId,
    );
    setSortConditions([{ columnId: normCol, direction }, ...withoutCol]);
    store.getState().setSort({ columnId, direction });
  };

  const clearSort = () => {
    const withoutCol = filterState.sortConditions.filter(
      (s) => s.columnId !== normCol && s.columnId !== columnId,
    );
    setSortConditions(withoutCol);
    store.getState().setSort(null);
  };

  return (
    <>
      <span className={styles.headerMenu}>
        <MenuButton
          size="xxs"
          aria-label={`Options for ${title}`}
          closeMenuOnItemClick
          dialogPosition="bottom-start"
        >
          <Menu id={`column-menu-${group.id}-${columnId}`} size="medium">
            {column && SETTINGS_TYPES.has(column.def.type) && env.canEdit ? (
              <MenuItem
                title="Settings"
                icon={Settings}
                onClick={() => store.getState().setSettingsFor({ groupId: group.id, columnId })}
              />
            ) : null}
            {subitems ? null : (
              <MenuItem
                title="Sort ascending"
                icon={SortAscending}
                onClick={() => applySort('asc')}
              />
            )}
            {subitems ? null : (
              <MenuItem
                title="Sort descending"
                icon={SortDescending}
                onClick={() => applySort('desc')}
              />
            )}
            {sort ? <MenuItem title="Clear sort" onClick={clearSort} /> : null}
            {column && env.canEdit && !subitems ? <MenuDivider /> : null}
            {column && env.canEdit ? (
              <MenuItem
                title="Rename"
                icon={Edit}
                onClick={() => store.getState().setRenamingColumn({ groupId: group.id, columnId })}
              />
            ) : null}
            {column && env.canEdit ? (
              <MenuItem
                title="Duplicate column"
                icon={Duplicate}
                onClick={() => void tableActions.duplicateColumn(env.ctx, column, scopeItems())}
              />
            ) : null}
            {column && env.canEdit ? (
              <MenuItem title="Add column to the right" icon={Add}>
                <Menu id={`column-add-${group.id}-${columnId}`} size="medium">
                  {ADD_COLUMN_ORDER.map((type) => (
                    <MenuItem
                      key={type}
                      title={columnRegistry.get(type).label}
                      icon={getColumnUi(type)?.icon}
                      onClick={() => void addColumn(env.ctx, type, group.id, columnId)}
                    />
                  ))}
                </Menu>
              </MenuItem>
            ) : null}
            {column && env.canEdit ? <MenuDivider /> : null}
            {column && env.canEdit ? (
              <MenuItem title="Delete" icon={Delete} onClick={() => setConfirmDelete(true)} />
            ) : null}
          </Menu>
        </MenuButton>
      </span>
      {confirmDelete && column ? (
        <ConfirmDialog
          title={`Delete "${column.def.title}"?`}
          message="This removes the column and all of its values from every item."
          confirmLabel="Delete column"
          onClose={() => setConfirmDelete(false)}
          onConfirm={() =>
            tableActions.deleteColumn(
              env.ctx,
              column.def,
              scopeItems().map((i) => i.id),
            )
          }
        />
      ) : null}
    </>
  );
}

/** Add a column and start renaming it in the header the request came from. */
async function addColumn(
  ctx: Parameters<typeof tableActions.addColumn>[0],
  type: string,
  groupId: string,
  afterColumnId?: string,
) {
  const id = await tableActions.addColumn(ctx, type, afterColumnId);
  if (id) useTableStore.getState().setRenamingColumn({ groupId, columnId: id });
}

/** The "+" cell at the end of the header: opens the "Essentials" column picker. */
function AddColumnCell({ group }: { group: GroupDef }) {
  const env = useTableEnv();
  const [open, setOpen] = useState(false);
  const [element, setElement] = useState<HTMLElement | null>(null);

  return (
    <div ref={setElement} className={styles.addColumn} role="columnheader">
      {env.canEdit ? (
        <button
          type="button"
          className={styles.addColumnButton}
          aria-label="Add column"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Add aria-hidden="true" />
        </button>
      ) : null}
      {open ? (
        <AnchoredPopup anchor={element} onClose={() => setOpen(false)} label="Add column">
          <div className={styles.pickerBody}>
            <h3 className={styles.pickerTitle}>Essentials</h3>
            <div className={styles.pickerGrid}>
              {ADD_COLUMN_ORDER.map((type) => {
                const ui = getColumnUi(type);
                const Icon = ui?.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    className={styles.pickerItem}
                    onClick={() => {
                      setOpen(false);
                      void addColumn(env.ctx, type, group.id);
                    }}
                  >
                    <span className={classNames(styles.tile, toneClass(ui?.tone))}>
                      {Icon ? <Icon aria-hidden="true" /> : null}
                    </span>
                    {columnRegistry.get(type).label}
                  </button>
                );
              })}
            </div>
          </div>
        </AnchoredPopup>
      ) : null}
    </div>
  );
}

function toneClass(tone: string | undefined): string | undefined {
  switch (tone) {
    case 'green':
      return styles.toneGreen;
    case 'orange':
      return styles.toneOrange;
    case 'blue':
      return styles.toneBlue;
    case 'purple':
      return styles.tonePurple;
    case 'pink':
      return styles.tonePink;
    case 'teal':
      return styles.toneTeal;
    case 'indigo':
      return styles.toneIndigo;
    case 'red':
      return styles.toneRed;
    default:
      return styles.toneGrey;
  }
}
