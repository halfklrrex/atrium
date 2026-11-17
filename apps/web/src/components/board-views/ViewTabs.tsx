import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MAIN_VIEW_ID } from '@atrium/shared';
import {
  Dialog,
  DialogContentContainer,
  Icon,
  Menu,
  MenuButton,
  MenuItem,
  Tab,
  TabList,
  Tooltip,
} from '@vibe/core';
import {
  Add,
  Board,
  Calendar,
  Chart,
  Gallery,
  Delete,
  DropdownChevronDown,
  Duplicate,
  Edit,
  Form,
  Gantt,
  MoreActions,
  Person,
  Pin,
  Table,
  Team,
  Timeline,
} from '@vibe/icons';
import classNames from 'classnames';
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  type ComponentProps,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { type BoardViewDoc } from '../../data';
import { ConfirmDialog } from '../board-table/ConfirmDialog';
import { useViewIdDirty } from '../board-filters';
import { viewActions } from './view-actions';
import { useBoardViewsContext } from './view-context';
import { viewPermissions } from './view-permissions';
import { fitVisibleTabs } from './view-tabs-overflow';
import styles from './ViewTabs.module.css';

/** Wait for the tab menu to close (and give focus back) before the rename input takes it. */
const RENAME_DELAY_MS = 150;

const VIEW_ICONS = {
  table: Table,
  kanban: Board,
  calendar: Calendar,
  timeline: Timeline,
  gantt: Gantt,
  workload: Team,
  chart: Chart,
  files: Gallery,
  form: Form,
} as const;

/** Gap between the tab list and the "N more" trigger (`.tabs` in the CSS) or the "+" button (`.row`). */
const TAB_GAP = 8;
const ROW_GAP = 4;
/** Room kept for the unsaved-changes dot, which appears on the selected tab after measuring. */
const SLACK = 16;
/** Width of the "N more" trigger until it has been measured. */
const MORE_FALLBACK = 96;

const SOON_VIEWS = [{ title: 'Map', icon: Pin }] as const;

/** Props Vibe's `TabList` hands to each child tab; passed on to the real `Tab`. */
type VibeTabProps = Omit<ComponentProps<typeof Tab>, 'children' | 'icon' | 'className'>;

interface ViewTabProps extends VibeTabProps {
  view: BoardViewDoc;
  boardId: string;
  renaming: boolean;
  menuOpen: boolean;
  menu: ReactNode;
  onMenuOpenChange: (open: boolean) => void;
  onRenameDone: (name: string | null) => void;
}

/**
 * Inline rename: Enter or blur saves, Escape cancels; reports once. Vibe's tab list handles Enter
 * and the arrow keys with a native listener that stops them, so the keys are caught natively here,
 * on the input itself, before they bubble that far.
 */
function RenameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const focused = useRef(false);
  const latest = useRef(onDone);
  useEffect(() => {
    latest.current = onDone;
  });
  const finish = useCallback((value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    latest.current(value);
  }, []);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    input.select();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(input.value);
      else if (event.key === 'Escape') finish(null);
    };
    input.addEventListener('keydown', onKeyDown);
    return () => input.removeEventListener('keydown', onKeyDown);
  }, [finish]);
  return (
    <input
      ref={ref}
      className={styles.renameInput}
      defaultValue={name}
      aria-label="View name"
      maxLength={60}
      onClick={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onFocus={() => {
        focused.current = true;
      }}
      // A blur before the input ever had focus is not the user leaving it.
      onBlur={(event) => focused.current && finish(event.currentTarget.value)}
    />
  );
}

/**
 * One view tab: type icon, name (an input while renaming), a person icon for personal views, a dot
 * for unsaved changes and the "..." menu. `TabList` clones its children, so this forwards everything
 * it is given to the Vibe `Tab` it renders.
 */
const ViewTab = forwardRef<HTMLLIElement, ViewTabProps>(function ViewTab(
  { view, boardId, renaming, menuOpen, menu, onMenuOpenChange, onRenameDone, ...tabProps },
  forwardedRef,
) {
  const dirty = useViewIdDirty(boardId, view.id);
  const isMain = view.id === MAIN_VIEW_ID;
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: view.id,
    disabled: isMain || renaming,
  });
  const setRefs = (node: HTMLLIElement | null) => {
    setNodeRef(node);
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };
  const Type = VIEW_ICONS[view.type];

  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <Tab {...tabProps} {...{ ref: setRefs }} icon={Type} className={styles.tab}>
      <span
        className={classNames(styles.tabContent, isDragging && styles.dragging)}
        data-view-id={view.id}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        {...(renaming ? {} : listeners)}
      >
        {renaming ? (
          <RenameInput name={view.name} onDone={onRenameDone} />
        ) : (
          <span className={styles.name}>{view.name}</span>
        )}
        {view.ownerId !== null ? (
          <Tooltip content="Only you can see this view">
            <span className={styles.personal} role="img" aria-label="Personal view">
              <Icon icon={Person} size={14} />
            </span>
          </Tooltip>
        ) : null}
        {dirty ? <span className={styles.dot} role="img" aria-label="Unsaved changes" /> : null}
        {renaming ? null : (
          <span
            className={classNames(styles.more, menuOpen && styles.moreOpen)}
            onClick={stop}
            onKeyDown={stop}
            onPointerDown={stop}
          >
            <MenuButton
              component={MoreActions}
              size="xxs"
              aria-label={`Options for ${view.name}`}
              open={menuOpen}
              onMenuShow={() => onMenuOpenChange(true)}
              onMenuHide={() => onMenuOpenChange(false)}
              closeMenuOnItemClick
              dialogPosition="bottom-start"
            >
              {menu}
            </MenuButton>
          </span>
        )}
      </span>
    </Tab>
  );
});

/** The view tabs row of a board: tabs, the tab menu, drag to reorder and the "+" menu. */
export function ViewTabs() {
  const ctx = useBoardViewsContext();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BoardViewDoc | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const rowRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLSpanElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [tabWidths, setTabWidths] = useState<ReadonlyMap<string, number>>(new Map());
  // Bumped after a pick: remounting the dialog is what closes it (Vibe's Dialog has no `open` prop).
  const [moreKey, setMoreKey] = useState(0);
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const [addWidth, setAddWidth] = useState(0);
  const [moreWidth, setMoreWidth] = useState(MORE_FALLBACK);
  const allViews = ctx?.views;
  const hasViews = Boolean(allViews);
  const activeId = ctx?.view.id ?? '';
  // A tab's width depends on its name, type icon and personal icon; a change re-measures it.
  const widthKey = useCallback(
    (v: BoardViewDoc) => `${v.id}|${v.name}|${v.type}|${v.ownerId === null ? 0 : 1}`,
    [],
  );
  const measured = !allViews || allViews.every((v) => tabWidths.has(widthKey(v)));

  // Measure every tab once (all of them render for that one pass, before paint); after that only
  // the tabs that fit stay rendered.
  useLayoutEffect(() => {
    const root = tabsRef.current;
    if (!root || !allViews || measured) return;
    const next = new Map(tabWidths);
    let changed = false;
    const tabById = new Map<string, HTMLElement>();
    root.querySelectorAll<HTMLElement>('[data-view-id]').forEach((el) => {
      const li = el.closest('li');
      if (li && el.dataset.viewId) tabById.set(el.dataset.viewId, li);
    });
    for (const v of allViews) {
      const tab = tabById.get(v.id);
      if (!tab || next.has(widthKey(v))) continue;
      next.set(widthKey(v), Math.ceil(tab.getBoundingClientRect().width));
      changed = true;
    }
    if (changed) setTabWidths(next);
  }, [allViews, measured, tabWidths, widthKey]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const read = () => {
      setRowWidth(row.clientWidth);
      setAddWidth(addRef.current?.offsetWidth ?? 0);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(row);
    return () => observer.disconnect();
  }, [hasViews]);

  const visibleIds = useMemo(() => {
    // Null while measuring or without layout (jsdom): every tab shows.
    if (!allViews || !measured || !rowWidth) return null;
    const widths = new Map(allViews.map((v) => [v.id, tabWidths.get(widthKey(v)) ?? 0]));
    return fitVisibleTabs({
      ids: allViews.map((v) => v.id),
      widths,
      available: rowWidth - addWidth - ROW_GAP - SLACK,
      moreWidth: moreWidth + TAB_GAP,
      gap: 0, // Vibe tabs carry their own padding and sit flush
      activeId,
    });
  }, [allViews, measured, rowWidth, addWidth, moreWidth, tabWidths, widthKey, activeId]);
  useLayoutEffect(() => {
    const width = moreRef.current?.offsetWidth ?? 0;
    if (width > 0 && width !== moreWidth) setMoreWidth(width);
  }, [visibleIds, moreWidth]);

  if (!ctx) return null;

  const { views, view: shown, actions } = ctx;
  const visibleSet = visibleIds ? new Set(visibleIds) : null;
  const tabViews = visibleSet ? views.filter((v) => visibleSet.has(v.id)) : views;
  const hiddenViews = views.filter((v) => !tabViews.includes(v));
  const uid = actions.uid;
  const activeIndex = Math.max(
    0,
    tabViews.findIndex((v) => v.id === shown.id),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const moving = views.find((v) => v.id === active.id);
    const tabs = views.filter((v) => v.id !== MAIN_VIEW_ID);
    const to = tabs.findIndex((v) => v.id === over.id);
    if (!moving || to === -1) return;
    const perms = viewPermissions(moving, uid, actions.canEdit);
    if (!perms.canRename) return; // moving writes the view, so it follows the same right
    void viewActions.move(actions, moving, to);
  };

  const menuFor_ = (view: BoardViewDoc): ReactNode => {
    const perms = viewPermissions(view, uid, actions.canEdit);
    return (
      <Menu id={`view-menu-${view.id}`} size="medium">
        {perms.canRename ? (
          <MenuItem
            title="Rename"
            icon={Edit}
            onClick={() => {
              // The menu hands focus back to its button as it closes; start renaming after that.
              window.setTimeout(() => setRenamingId(view.id), RENAME_DELAY_MS);
            }}
          />
        ) : null}
        {view.type !== 'form' || actions.canEdit ? (
          <MenuItem
            title="Duplicate"
            icon={Duplicate}
            onClick={() => void viewActions.duplicate(actions, view)}
          />
        ) : null}
        {perms.canChangeScope && view.type !== 'form' ? (
          <MenuItem
            title={view.ownerId === null ? 'Make personal' : 'Make shared'}
            icon={Person}
            onClick={() => void viewActions.changeScope(actions, view, view.ownerId === null)}
          />
        ) : null}
        {perms.canDelete ? (
          <MenuItem title="Delete" icon={Delete} onClick={() => setDeleting(view)} />
        ) : null}
      </Menu>
    );
  };

  const onContextMenu = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('[data-view-id]') : null;
    const id = target instanceof HTMLElement ? target.dataset.viewId : undefined;
    if (!id) return;
    event.preventDefault();
    setMenuFor(id);
  };

  return (
    <div className={styles.row} ref={rowRef} onContextMenu={onContextMenu} data-print="hide">
      <div className={styles.tabs} ref={tabsRef}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={tabViews.map((v) => v.id)}
            strategy={horizontalListSortingStrategy}
          >
            <TabList
              activeTabId={activeIndex}
              stretchedUnderline
              onTabChange={(index: number) => {
                const next = tabViews[index];
                if (next && next.id !== shown.id) actions.goTo(next.id);
              }}
            >
              {tabViews.map((view) => (
                <ViewTab
                  key={view.id}
                  view={view}
                  boardId={actions.boardId}
                  renaming={renamingId === view.id}
                  menuOpen={menuFor === view.id}
                  menu={menuFor_(view)}
                  onMenuOpenChange={(open) =>
                    setMenuFor((current) => (open ? view.id : current === view.id ? null : current))
                  }
                  onRenameDone={(name) => {
                    setRenamingId(null);
                    if (name !== null) void viewActions.rename(actions, view, name);
                  }}
                />
              ))}
            </TabList>
          </SortableContext>
        </DndContext>
        {hiddenViews.length > 0 ? (
          <Dialog
            key={moreKey}
            showTrigger={['click']}
            hideTrigger={['clickoutside', 'esckey', 'onContentClick']}
            position="bottom-start"
            moveBy={{ main: 0, secondary: 0 }}
            content={
              <DialogContentContainer>
                <Menu id="more-views-menu" size="medium" focusOnMount>
                  {hiddenViews.map((view) => (
                    <MenuItem
                      key={view.id}
                      title={view.name}
                      icon={VIEW_ICONS[view.type]}
                      onClick={() => {
                        actions.goTo(view.id);
                        setMoreKey((k) => k + 1);
                      }}
                    />
                  ))}
                </Menu>
              </DialogContentContainer>
            }
          >
            <button
              ref={moreRef}
              type="button"
              className={styles.moreViews}
              aria-haspopup="menu"
              aria-label={`${hiddenViews.length} more ${hiddenViews.length === 1 ? 'view' : 'views'}`}
            >
              <span>{hiddenViews.length} more</span>
              <Icon icon={DropdownChevronDown} size={16} aria-hidden />
            </button>
          </Dialog>
        ) : null}
      </div>

      <span ref={addRef} className={styles.addWrap}>
        <MenuButton
          component={Add}
          size="xs"
          aria-label="Add view"
          closeMenuOnItemClick
          dialogPosition="bottom-start"
          className={styles.add}
        >
          <Menu id="add-view-menu" size="medium">
            <MenuItem
              title="Table"
              icon={Table}
              onClick={() => void viewActions.add(actions, 'table')}
            />
            <MenuItem
              title="Kanban"
              icon={Board}
              onClick={() => void viewActions.add(actions, 'kanban')}
            />
            <MenuItem
              title="Calendar"
              icon={Calendar}
              onClick={() => void viewActions.add(actions, 'calendar')}
            />
            <MenuItem
              title="Timeline"
              icon={Timeline}
              onClick={() => void viewActions.add(actions, 'timeline')}
            />
            <MenuItem
              title="Gantt"
              icon={Gantt}
              onClick={() => void viewActions.add(actions, 'gantt')}
            />
            <MenuItem
              title="Workload"
              icon={Team}
              onClick={() => void viewActions.add(actions, 'workload')}
            />
            <MenuItem
              title="Chart"
              icon={Chart}
              onClick={() => void viewActions.add(actions, 'chart')}
            />
            <MenuItem
              title="Files gallery"
              icon={Gallery}
              onClick={() => void viewActions.add(actions, 'files')}
            />
            {actions.canEdit ? (
              <MenuItem
                title="Form"
                icon={Form}
                onClick={() => void viewActions.add(actions, 'form')}
              />
            ) : null}
            {SOON_VIEWS.map((soon) => (
              <MenuItem
                key={soon.title}
                title={soon.title}
                icon={soon.icon}
                disabled
                tooltipContent="Coming soon"
                onClick={() => undefined}
              />
            ))}
          </Menu>
        </MenuButton>
      </span>

      {deleting ? (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          message="The view and its saved filters are removed. You can undo this right after."
          confirmLabel="Delete view"
          onConfirm={() => viewActions.remove(actions, deleting, deleting.id === shown.id)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
