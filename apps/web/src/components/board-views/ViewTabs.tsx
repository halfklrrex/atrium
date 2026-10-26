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
import { Icon, Menu, MenuButton, MenuItem, Tab, TabList, Tooltip } from '@vibe/core';
import {
  Add,
  Board,
  Calendar,
  Chart,
  Delete,
  Duplicate,
  Edit,
  Gantt,
  MoreActions,
  Person,
  Pin,
  Table,
  Timeline,
} from '@vibe/icons';
import classNames from 'classnames';
import {
  forwardRef,
  useCallback,
  useEffect,
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
import styles from './ViewTabs.module.css';

/** Wait for the tab menu to close (and give focus back) before the rename input takes it. */
const RENAME_DELAY_MS = 150;

const VIEW_ICONS = { table: Table, kanban: Board } as const;

const SOON_VIEWS = [
  { title: 'Calendar', icon: Calendar },
  { title: 'Timeline', icon: Timeline },
  { title: 'Gantt', icon: Gantt },
  { title: 'Chart', icon: Chart },
  { title: 'Map', icon: Pin },
] as const;

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
  if (!ctx) return null;

  const { views, view: shown, actions } = ctx;
  const uid = actions.uid;
  const activeIndex = Math.max(
    0,
    views.findIndex((v) => v.id === shown.id),
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
        <MenuItem
          title="Duplicate"
          icon={Duplicate}
          onClick={() => void viewActions.duplicate(actions, view)}
        />
        {perms.canChangeScope ? (
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
    <div className={styles.row} ref={rowRef} onContextMenu={onContextMenu}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={views.map((v) => v.id)} strategy={horizontalListSortingStrategy}>
          <TabList
            activeTabId={activeIndex}
            stretchedUnderline
            onTabChange={(index: number) => {
              const next = views[index];
              if (next && next.id !== shown.id) actions.goTo(next.id);
            }}
          >
            {views.map((view) => (
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
            disabled
            tooltipContent="Coming soon"
            onClick={() => undefined}
          />
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
