import type { GroupDef } from '@atrium/shared';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Menu, MenuButton, MenuDivider, MenuItem } from '@vibe/core';
import {
  Add,
  Collapse,
  Delete,
  Duplicate,
  Edit,
  Expand,
  MoveArrowDown,
  MoveArrowUp,
  NavigationChevronDown,
  NavigationChevronRight,
  NoColor,
} from '@vibe/icons';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { GROUP_COLORS } from '../../theme/palette';
import { InlineEdit } from '../InlineEdit';
import { AddItemRow } from './AddItemRow';
import { AnchoredPopup } from './AnchoredPopup';
import { ConfirmDialog } from './ConfirmDialog';
import { dragProps } from './drag-props';
import { HeaderRow } from './HeaderRow';
import { ItemEntry } from './ItemEntry';
import { SummaryCell, SummaryRow } from './SummaryRow';
import { tableActions } from './table-actions';
import { useTableEnv } from './table-env';
import { VIRTUALIZE_AFTER, groupItemCountLabel, groupKey, type GroupModel } from './table-model';
import { useTablePrefs, useTableStore } from './table-store';
import styles from './table.module.css';

const ROW_HEIGHT_ESTIMATE = 36;
const OVERSCAN = 12;

interface GroupBlockProps {
  model: GroupModel;
  term: string;
  /** Dragging items is off while a sort or a search is reordering what is shown. */
  dragDisabled: boolean;
}

/** One group: title row, then (unless collapsed) header, rows, "+ Add item" and the footer. */
export const GroupBlock = memo(function GroupBlock({ model, term, dragDisabled }: GroupBlockProps) {
  const env = useTableEnv();
  const { group, items, all } = model;
  const collapsedPref = useTablePrefs((s) => s.collapsed[env.boardId]?.includes(group.id) ?? false);
  const draggingGroup = useTableStore((s) => s.draggingGroup);
  const endMarker = useTableStore(
    (s) => s.dropMarker?.groupId === group.id && s.dropMarker.itemId === null,
  );
  const collapsed = collapsedPref || draggingGroup;

  // A group just added from the controls opens its title for typing and scrolls into view.
  const [isNew] = useState(() => useTableStore.getState().renamingGroupId === group.id);
  const [titleEditing, setTitleEditing] = useState(isNew);
  const sectionNode = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!isNew) return;
    useTableStore.getState().setRenamingGroup(null);
    sectionNode.current?.scrollIntoView?.({ block: 'nearest' });
  }, [isNew]);
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canEditTitle = env.canEdit && !model.synthetic;

  const sortable = useSortable({
    id: groupKey(group.id),
    data: { type: 'group' },
    disabled: !env.canEdit || titleEditing || Boolean(model.synthetic),
  });
  const body = useDroppable({
    id: `drop:${group.id}`,
    data: { type: 'group-drop', groupId: group.id },
    disabled: Boolean(model.synthetic),
  });

  const setCollapsed = (value: boolean) =>
    useTablePrefs.getState().setGroupCollapsed(env.boardId, group.id, value);

  const style: CSSProperties = {
    '--group-color': group.color,
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  } as CSSProperties;

  const count = all.length;
  const setTitleRefs = (node: HTMLDivElement | null) => {
    sortable.setActivatorNodeRef(node);
    setTitleEl(node);
  };
  const setSectionRef = (node: HTMLElement | null) => {
    sectionNode.current = node;
    sortable.setNodeRef(node);
  };
  const setBodyRef = (node: HTMLElement | null) => body.setNodeRef(node);
  const dragHandle = dragProps(sortable);

  const menu = canEditTitle ? (
    <GroupMenu
      group={group}
      count={count}
      collapsed={collapsedPref}
      onRename={() => setTitleEditing(true)}
      onColor={() => setPaletteOpen(true)}
      onDelete={() => setConfirmDelete(true)}
      onCollapse={setCollapsed}
      allItems={all}
    />
  ) : null;

  return (
    <section
      ref={setSectionRef}
      aria-label={group.title}
      className={classNames(styles.group, sortable.isDragging && styles.groupLifted)}
      style={style}
    >
      {collapsed ? (
        <div ref={setBodyRef}>
          <div role="grid" aria-label={`${group.title} (collapsed)`}>
            <div
              role="row"
              className={classNames(
                styles.collapsedRow,
                styles.tinted,
                endMarker && styles.dropBefore,
              )}
            >
              <div className={classNames(styles.sticky, styles.tinted)}>
                <span className={styles.groupMenu} data-collapsed>
                  {menu}
                </span>
                <span className={classNames(styles.bar, styles.collapsedBar)} />
                <div
                  className={styles.collapsedName}
                  ref={setTitleRefs}
                  {...dragHandle}
                  role="presentation"
                  tabIndex={-1}
                >
                  <button
                    type="button"
                    className={styles.chevron}
                    aria-expanded={false}
                    aria-label={`Expand group ${group.title}`}
                    onClick={() => setCollapsed(false)}
                  >
                    <NavigationChevronRight aria-hidden="true" />
                  </button>
                  <span className={styles.groupTitle}>{group.title}</span>
                  <span className={classNames(styles.groupCount, styles.groupCountShown)}>
                    {groupItemCountLabel(count)}
                  </span>
                </div>
              </div>
              {env.columns.map((column) => (
                <SummaryCell key={column.def.id} column={column} items={items} />
              ))}
              <div />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            className={styles.titleRow}
            ref={setTitleRefs}
            {...dragHandle}
            role="presentation"
            tabIndex={-1}
          >
            <span className={styles.groupMenu}>{menu}</span>
            <button
              type="button"
              className={styles.chevron}
              aria-expanded
              aria-label={`Collapse group ${group.title}`}
              onClick={() => setCollapsed(true)}
            >
              <NavigationChevronDown aria-hidden="true" />
            </button>
            <InlineEdit
              value={group.title}
              ariaLabel="Group title"
              readOnly={!canEditTitle}
              maxLength={120}
              editing={titleEditing && canEditTitle}
              onEditingChange={(v) => canEditTitle && setTitleEditing(v)}
              className={styles.groupTitle}
              onCommit={(title) => void tableActions.updateGroup(env.ctx, group.id, { title })}
            />
            <span className={styles.groupCount}>{groupItemCountLabel(count)}</span>
          </div>

          <div ref={setBodyRef} role="grid" aria-label={`${group.title} items`}>
            <HeaderRow group={group} itemIds={items.map((i) => i.id)} />
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {items.length > VIRTUALIZE_AFTER ? (
                <VirtualRows
                  items={items}
                  group={group}
                  term={term}
                  dragDisabled={dragDisabled}
                  subitemsByParent={model.subitemsByParent}
                  autoExpanded={model.autoExpanded}
                />
              ) : (
                items.map((item) => (
                  <ItemEntry
                    key={item.id}
                    item={item}
                    group={group}
                    term={term}
                    dragDisabled={dragDisabled}
                    subitems={model.subitemsByParent.get(item.id)}
                    autoExpanded={model.autoExpanded.has(item.id)}
                  />
                ))
              )}
            </SortableContext>
            {!model.synthetic ? <AddItemRow group={group} items={all} /> : null}
            <SummaryRow group={group} items={items} />
          </div>
        </>
      )}

      {paletteOpen ? (
        <AnchoredPopup anchor={titleEl} onClose={() => setPaletteOpen(false)} label="Group colour">
          <div className={styles.swatchGrid} role="radiogroup" aria-label="Group colour">
            {GROUP_COLORS.map((color) => (
              <button
                key={color.hex}
                type="button"
                role="radio"
                aria-checked={color.hex.toLowerCase() === group.color.toLowerCase()}
                aria-label={color.label}
                title={color.label}
                className={classNames(
                  styles.swatchButton,
                  color.hex.toLowerCase() === group.color.toLowerCase() && styles.swatchOn,
                )}
                style={{ backgroundColor: color.hex }}
                onClick={() => {
                  setPaletteOpen(false);
                  void tableActions.updateGroup(env.ctx, group.id, { color: color.hex });
                }}
              />
            ))}
          </div>
        </AnchoredPopup>
      ) : null}
      {confirmDelete ? (
        <ConfirmDialog
          title="Delete group?"
          message={`Delete this group and its ${count} ${count === 1 ? 'item' : 'items'}?`}
          confirmLabel="Delete group"
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => tableActions.deleteGroup(env.ctx, group, all)}
        />
      ) : null}
    </section>
  );
});

/** Rows of a big group: only those near the viewport are mounted, in normal flow of the group. */
function VirtualRows({
  items,
  group,
  term,
  dragDisabled,
  subitemsByParent,
  autoExpanded,
}: {
  items: readonly GroupModel['items'][number][];
  group: GroupDef;
  term: string;
  dragDisabled: boolean;
  subitemsByParent: GroupModel['subitemsByParent'];
  autoExpanded: GroupModel['autoExpanded'];
}) {
  const env = useTableEnv();
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const scrollElement = env.scrollElement;

  // Where the list starts inside the scrolling content; it moves when groups above grow or collapse.
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
    // A row is 36px; an open parent adds its header, its subitems and "+ Add subitem". The real
    // height is measured once the row is mounted (`measureElement` below).
    estimateSize: (index) => {
      const item = items[index]!;
      const open = autoExpanded.has(item.id) || useTableStore.getState().expanded.has(item.id);
      const subs = subitemsByParent.get(item.id)?.length ?? 0;
      return ROW_HEIGHT_ESTIMATE * (open ? 3 + subs : 1);
    },
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
      {virtualizer.getVirtualItems().map((virtual) => {
        const item = items[virtual.index]!;
        return (
          <div
            key={item.id}
            ref={virtualizer.measureElement}
            data-index={virtual.index}
            className={styles.virtualRow}
            style={{ transform: `translateY(${virtual.start - margin}px)` }}
          >
            <ItemEntry
              item={item}
              group={group}
              term={term}
              dragDisabled={dragDisabled}
              subitems={subitemsByParent.get(item.id)}
              autoExpanded={autoExpanded.has(item.id)}
            />
          </div>
        );
      })}
    </div>
  );
}

interface GroupMenuProps {
  group: GroupDef;
  count: number;
  collapsed: boolean;
  allItems: readonly GroupModel['items'][number][];
  onRename: () => void;
  onColor: () => void;
  onDelete: () => void;
  onCollapse: (collapsed: boolean) => void;
}

function GroupMenu({
  group,
  collapsed,
  allItems,
  onRename,
  onColor,
  onDelete,
  onCollapse,
}: GroupMenuProps) {
  const env = useTableEnv();
  const { ctx } = env;
  const collapseAll = (value: boolean) =>
    useTablePrefs.getState().setManyCollapsed(
      env.boardId,
      env.groups.map((g) => g.id),
      value,
    );

  return (
    <MenuButton
      size="xxs"
      aria-label={`Options for group ${group.title}`}
      closeMenuOnItemClick
      dialogPosition="bottom-start"
    >
      <Menu id={`group-menu-${group.id}`} size="medium">
        <MenuItem
          title={collapsed ? 'Expand this group' : 'Collapse this group'}
          icon={collapsed ? Expand : Collapse}
          onClick={() => onCollapse(!collapsed)}
        />
        <MenuItem title="Collapse all groups" icon={Collapse} onClick={() => collapseAll(true)} />
        <MenuItem title="Expand all groups" icon={Expand} onClick={() => collapseAll(false)} />
        <MenuDivider />
        <MenuItem
          title="Add group above"
          icon={Add}
          onClick={() => void tableActions.addGroup(ctx, { above: group.id })}
        />
        <MenuItem
          title="Add group below"
          icon={Add}
          onClick={() => void tableActions.addGroup(ctx, { below: group.id })}
        />
        <MenuDivider />
        <MenuItem title="Rename group" icon={Edit} onClick={onRename} />
        <MenuItem title="Change group colour" icon={NoColor} onClick={onColor} />
        <MenuItem
          title="Duplicate group"
          icon={Duplicate}
          onClick={() => void tableActions.duplicateGroup(ctx, group, allItems)}
        />
        <MenuItem
          title="Move to top"
          icon={MoveArrowUp}
          onClick={() => void tableActions.moveGroup(ctx, group.id, 'top')}
        />
        <MenuItem
          title="Move to bottom"
          icon={MoveArrowDown}
          onClick={() => void tableActions.moveGroup(ctx, group.id, 'bottom')}
        />
        <MenuDivider />
        <MenuItem title="Delete group" icon={Delete} onClick={onDelete} />
      </Menu>
    </MenuButton>
  );
}
