import type { GroupDef } from '@atrium/shared';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Menu, MenuButton, MenuDivider, MenuItem, Tooltip } from '@vibe/core';
import {
  Add,
  AddUpdate,
  Archive,
  Delete,
  Duplicate,
  Edit,
  Move,
  NavigationChevronRight,
  Open,
  Subitems,
  Update,
} from '@vibe/icons';
import classNames from 'classnames';
import {
  memo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import type { ItemDoc } from '../../data';
import { positionAfterAll } from '../../lib/positions';
import { dragProps } from './drag-props';
import { Highlight } from './Highlight';
import { openItem, openItemFull } from './open-item';
import { tableActions } from './table-actions';
import { isRowDone, useTableEnv } from './table-env';
import { NAME_COLUMN } from './table-model';
import { useTableStore } from './table-store';
import { TableCell } from './TableCell';
import { TableCheckbox } from './TableCheckbox';
import styles from './table.module.css';

interface ItemRowProps {
  item: ItemDoc;
  group: GroupDef;
  /** Search term to highlight; empty when not searching. */
  term: string;
  /** Dragging is off while a sort or a search reorders what is shown. */
  dragDisabled: boolean;
  /** How many subitems the item has (drives the arrow and the count badge). */
  subitemCount: number;
  /** The subitem block is open. */
  expanded: boolean;
  /** The subitem block, rendered under the row and moving with it while dragging. */
  children?: ReactNode;
}

/**
 * One item: bar, checkbox, name, value cells, and under it the subitem block when open. The
 * sortable node is the wrapper around both, so a dragged parent carries its block along.
 */
export function ItemRow({
  item,
  group,
  term,
  dragDisabled,
  subitemCount,
  expanded,
  children,
}: ItemRowProps) {
  const env = useTableEnv();
  const selected = useTableStore((s) => s.selected.has(item.id));
  const activeColumn = useTableStore((s) =>
    s.active?.itemId === item.id ? s.active.columnId : null,
  );
  const editingColumn = useTableStore((s) =>
    s.editing?.itemId === item.id ? s.editing.columnId : null,
  );
  const renaming = useTableStore((s) => s.renamingItemId === item.id);
  const dropEdge = useTableStore((s) =>
    s.dropMarker?.itemId === item.id ? s.dropMarker.edge : null,
  );

  const sortable = useSortable({
    id: item.id,
    data: { type: 'item', groupId: group.id },
    disabled: dragDisabled || !env.canEdit || editingColumn !== null || renaming,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  const addSubitem = async () => {
    const store = useTableStore.getState();
    store.toggleExpanded(item.id, true);
    const siblings = env.getItems().filter((i) => i.parentItemId === item.id);
    const id = await tableActions.addSubitem(env.ctx, item, {
      position: positionAfterAll(siblings),
    });
    if (id) {
      store.setRenamingItem(id);
      store.setActive({ itemId: id, columnId: NAME_COLUMN });
    }
  };

  return (
    <SortableWrap nodeRef={sortable.setNodeRef} style={style} ghost={sortable.isDragging}>
      <ItemRowBody
        item={item}
        groupColor={group.color}
        term={term}
        selected={selected}
        activeColumn={activeColumn}
        editingColumn={editingColumn}
        renaming={renaming}
        subitemCount={subitemCount}
        expanded={expanded}
        onToggleExpand={() => useTableStore.getState().toggleExpanded(item.id)}
        onAddSubitem={() => void addSubitem()}
        rowProps={{
          ...dragProps(sortable),
          className: classNames(
            dropEdge === 'before' && styles.dropBefore,
            dropEdge === 'after' && styles.dropAfter,
          ),
        }}
      />
      {children}
    </SortableWrap>
  );
}

/** The sortable node of an item: the row plus its subitem block, moved and ghosted together. */
function SortableWrap({
  nodeRef,
  style,
  ghost,
  children,
}: {
  nodeRef: Ref<HTMLDivElement>;
  style: CSSProperties;
  ghost: boolean;
  children: ReactNode;
}) {
  return (
    <div ref={nodeRef} style={style} className={classNames(ghost && styles.rowGhost)}>
      {children}
    </div>
  );
}

/** A subitem row inside an open block: sortable among its siblings only. */
export const SubitemRow = memo(function SubitemRow({
  item,
  groupColor,
  term,
  dragDisabled,
}: {
  item: ItemDoc;
  groupColor: string;
  term: string;
  dragDisabled: boolean;
}) {
  const env = useTableEnv();
  const selected = useTableStore((s) => s.selected.has(item.id));
  const activeColumn = useTableStore((s) =>
    s.active?.itemId === item.id ? s.active.columnId : null,
  );
  const editingColumn = useTableStore((s) =>
    s.editing?.itemId === item.id ? s.editing.columnId : null,
  );
  const renaming = useTableStore((s) => s.renamingItemId === item.id);

  const sortable = useSortable({
    id: item.id,
    data: { type: 'subitem', parentId: item.parentItemId, groupId: item.groupId },
    disabled: dragDisabled || !env.canEdit || editingColumn !== null || renaming,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <ItemRowBody
      item={item}
      groupColor={groupColor}
      term={term}
      selected={selected}
      activeColumn={activeColumn}
      editingColumn={editingColumn}
      renaming={renaming}
      subitem
      rowRef={sortable.setNodeRef}
      rowProps={{
        ...dragProps(sortable),
        style,
        className: classNames(sortable.isDragging && styles.rowGhost),
      }}
    />
  );
});

interface ItemRowBodyProps {
  item: ItemDoc;
  groupColor: string;
  term: string;
  selected: boolean;
  activeColumn: string | null;
  editingColumn: string | null;
  renaming: boolean;
  /** Presentational copy used for the drag overlay: no menus, no store, no interaction. */
  overlay?: boolean;
  /** A subitem row: its own columns, no updates bubble and no item card. */
  subitem?: boolean;
  subitemCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onAddSubitem?: () => void;
  rowRef?: Ref<HTMLDivElement>;
  rowProps?: HTMLAttributes<HTMLDivElement>;
}

/** The markup of an item row, shared by the live row and the lifted copy shown while dragging. */
export function ItemRowBody({
  item,
  groupColor,
  term,
  selected,
  activeColumn,
  editingColumn,
  renaming,
  overlay = false,
  subitem = false,
  subitemCount = 0,
  expanded = false,
  onToggleExpand,
  onAddSubitem,
  rowRef,
  rowProps,
}: ItemRowBodyProps) {
  const env = useTableEnv();
  const [menuReady, setMenuReady] = useState(false);
  const done = isRowDone(item, env.columns);
  const { className: extraClass, ...restProps } = rowProps ?? {};

  return (
    <div
      {...restProps}
      ref={rowRef}
      role="row"
      tabIndex={-1}
      aria-selected={selected}
      aria-expanded={subitem || subitemCount === 0 ? undefined : expanded}
      data-item-id={item.id}
      className={classNames(
        styles.row,
        styles.tinted,
        subitem && styles.subitemRow,
        selected && styles.rowSelected,
        overlay && styles.rowLifted,
        extraClass,
      )}
      onMouseEnter={() => setMenuReady(true)}
      onFocus={() => setMenuReady(true)}
    >
      <div
        className={classNames(styles.sticky, styles.tinted)}
        style={{ '--group-color': groupColor } as CSSProperties}
      >
        {overlay || !env.canEdit ? null : menuReady ? (
          <RowMenu item={item} subitem={subitem} onAddSubitem={onAddSubitem} />
        ) : (
          <span className={styles.rowMenu} />
        )}
        <span className={styles.bar} />
        <div className={styles.checkCell} role="gridcell">
          <TableCheckbox
            checked={selected}
            label={`Select ${item.name}`}
            onChange={() => useTableStore.getState().toggleSelected(item.id)}
          />
        </div>
        <NameCell
          item={item}
          term={term}
          renaming={renaming}
          active={activeColumn === NAME_COLUMN}
          overlay={overlay}
          subitem={subitem}
          subitemCount={subitemCount}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
        />
      </div>
      {env.columns.map((column) => (
        <TableCell
          key={column.def.id}
          item={item}
          column={column}
          rowDone={done}
          highlight={term}
          active={activeColumn === column.def.id}
          editing={editingColumn === column.def.id}
        />
      ))}
      <div className={styles.filler} role="gridcell" />
    </div>
  );
}

function NameCell({
  item,
  term,
  renaming,
  active,
  overlay,
  subitem,
  subitemCount,
  expanded,
  onToggleExpand,
}: {
  item: ItemDoc;
  term: string;
  renaming: boolean;
  active: boolean;
  overlay: boolean;
  subitem: boolean;
  subitemCount: number;
  expanded: boolean;
  onToggleExpand?: () => void;
}) {
  const env = useTableEnv();
  // The arrow of an item without subitems only shows on hover (and for people who can add some).
  const showArrow = !subitem && !overlay && (subitemCount > 0 || env.canEdit);
  const updatesCount = item.updatesCount ?? 0;

  return (
    <>
      <div
        role="gridcell"
        className={classNames(styles.nameCell, active && styles.activeName)}
        data-cell={`${item.id}:${NAME_COLUMN}`}
        aria-selected={active}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            useTableStore.getState().setActive({ itemId: item.id, columnId: NAME_COLUMN });
          }
        }}
      >
        {showArrow ? (
          <button
            type="button"
            className={classNames(
              styles.expandArrow,
              subitemCount > 0 && styles.expandArrowShown,
              expanded && styles.expandArrowOpen,
            )}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} subitems of ${item.name}`}
            onClick={onToggleExpand}
          >
            <NavigationChevronRight aria-hidden="true" />
          </button>
        ) : null}
        {renaming && env.canEdit ? (
          <NameEditor item={item} />
        ) : (
          <button
            type="button"
            className={styles.nameText}
            onClick={() => {
              useTableStore.getState().setActive({ itemId: item.id, columnId: NAME_COLUMN });
              // TODO(subitems): the item card has no subitem view yet, so a subitem does not open it.
              if (!overlay && !subitem) openItem(env.boardId, item.id);
            }}
            onDoubleClick={() => {
              if (!env.canEdit || overlay) return;
              useTableStore.getState().setRenamingItem(item.id);
            }}
          >
            <Highlight text={item.name} term={term} />
          </button>
        )}
        {!subitem && subitemCount > 0 && !renaming ? (
          <button
            type="button"
            className={styles.subitemBadge}
            aria-label={`${subitemCount} ${subitemCount === 1 ? 'subitem' : 'subitems'}`}
            onClick={onToggleExpand}
          >
            <Subitems aria-hidden="true" />
            {subitemCount}
          </button>
        ) : null}
        {renaming || subitem ? null : (
          <Tooltip content="Open item" position="top">
            <button
              type="button"
              className={styles.openButton}
              aria-label={`Open ${item.name}`}
              onClick={() => openItemFull(env.boardId, item.id)}
            >
              <Open aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </div>
      {subitem ? null : (
        <div className={styles.bubble} role="gridcell">
          <button
            type="button"
            className={styles.bubbleButton}
            aria-label={
              updatesCount > 0
                ? `Updates for ${item.name} (${updatesCount})`
                : `Updates for ${item.name}`
            }
            onClick={() => openItem(env.boardId, item.id)}
          >
            {updatesCount > 0 ? (
              <span className={styles.bubbleWithCount}>
                <Update aria-hidden="true" />
                <span className={styles.bubbleBadge} aria-hidden="true">
                  {updatesCount > 9 ? '9+' : updatesCount}
                </span>
              </span>
            ) : (
              <AddUpdate aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </>
  );
}

/** Inline rename of an item: Enter or blur saves, Escape cancels. */
function NameEditor({ item }: { item: ItemDoc }) {
  const env = useTableEnv();
  const [draft, setDraft] = useState(item.name);
  const done = useRef(false);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const store = useTableStore.getState();
    store.setRenamingItem(null);
    store.setActive({ itemId: item.id, columnId: NAME_COLUMN });
    const next = draft.trim();
    if (save && next && next !== item.name) void tableActions.renameItem(env.ctx, item.id, next);
  };

  return (
    <input
      className={classNames(styles.nameInput, styles.addInput)}
      value={draft}
      aria-label={item.parentItemId ? 'Subitem name' : 'Item name'}
      maxLength={500}
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

/** The "⋯" row menu in the left gutter. Mounted on first hover, so idle rows stay light. */
function RowMenu({
  item,
  subitem,
  onAddSubitem,
}: {
  item: ItemDoc;
  subitem: boolean;
  onAddSubitem?: () => void;
}) {
  const env = useTableEnv();
  const { ctx } = env;

  const others = env.groups.filter((g) => g.id !== item.groupId);
  const targetItems = (groupId: string) =>
    env.getModels().find((m) => m.group.id === groupId)?.all ?? [];

  return (
    <span className={styles.rowMenu}>
      <MenuButton
        size="xxs"
        aria-label={`Options for ${item.name}`}
        closeMenuOnItemClick
        dialogPosition="bottom-start"
      >
        <Menu id={`row-menu-${item.id}`} size="medium">
          {subitem ? null : (
            <MenuItem
              title="Open item"
              icon={Open}
              onClick={() => openItem(env.boardId, item.id)}
            />
          )}
          <MenuItem
            title="Rename"
            icon={Edit}
            onClick={() => useTableStore.getState().setRenamingItem(item.id)}
          />
          {subitem ? null : <MenuItem title="Add subitem" icon={Add} onClick={onAddSubitem} />}
          <MenuItem
            title="Duplicate"
            icon={Duplicate}
            onClick={() => void tableActions.duplicateItems(ctx, [item], (g) => targetItems(g))}
          />
          {subitem ? null : (
            <MenuItem title="Move to group" icon={Move} disabled={others.length === 0}>
              <Menu id={`row-move-${item.id}`} size="medium">
                {others.map((group) => (
                  <MenuItem
                    key={group.id}
                    title={group.title}
                    onClick={() =>
                      void tableActions.moveItemsToGroup(
                        ctx,
                        [item],
                        group.id,
                        targetItems(group.id),
                      )
                    }
                  />
                ))}
              </Menu>
            </MenuItem>
          )}
          <MenuDivider />
          <MenuItem
            title="Archive"
            icon={Archive}
            onClick={() => void tableActions.retireItems(ctx, [item.id], 'archived')}
          />
          <MenuItem
            title="Delete"
            icon={Delete}
            onClick={() => void tableActions.retireItems(ctx, [item.id], 'deleted')}
          />
        </Menu>
      </MenuButton>
    </span>
  );
}
