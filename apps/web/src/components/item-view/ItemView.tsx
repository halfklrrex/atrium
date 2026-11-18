import {
  canEditBoard,
  columnsForItem,
  columnsForSubitems,
  isSubitem,
  resolveBoardRole,
  type ColumnDef,
} from '@atrium/shared';
import { IconButton, Loader, Menu, MenuButton, MenuItem, Tooltip } from '@vibe/core';
import {
  Archive,
  Close,
  Delete,
  Duplicate,
  Link as LinkIcon,
  NavigationChevronLeft,
  NavigationChevronRight,
} from '@vibe/icons';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { itemWrites, useItems, useWorkspace, type BoardDoc } from '../../data';
import { countMissingRequired } from '../board-table/required';
import { tableActions } from '../board-table/table-actions';
import { buildColumnViews } from '../board-table/table-model';
import { UpdatesFeed } from '../item-card/UpdatesFeed';
import { InlineEdit } from '../InlineEdit';
import { FieldsPanel } from './FieldsPanel';
import { copyItemLink } from './item-link';
import { ItemSubitems } from './ItemSubitems';
import type { DescriptionValue } from './description';
import {
  FROM_BOARD_STATE,
  boardPath,
  itemViewPath,
  neighbours,
  subitemNeighbours,
  subitemOpenState,
  useItemViewStore,
  type ItemViewRouteState,
} from './item-view-store';
import { useItemTableCtx } from './use-item-ctx';
import styles from './ItemView.module.css';

const DescriptionEditor = lazy(() => import('./DescriptionEditor'));

export interface ItemViewProps {
  board: BoardDoc;
  itemId: string;
}

/**
 * The full item view: a centred floating window at `/boards/:boardId/items/:itemId` with the
 * description, every field, the subitems and the updates thread. The board stays mounted behind it.
 */
export function ItemView({ board, itemId }: ItemViewProps) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const windowRef = useRef<HTMLDivElement>(null);
  const boardId = board.id;

  const { data: workspace } = useWorkspace(board.workspaceId);
  const { data: items, loading } = useItems(boardId);
  const boardRole = resolveBoardRole(board, uid, workspace?.roles[uid]);
  const canEdit = canEditBoard(boardRole);
  const item = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId]);
  const group = useMemo(
    () => board.groups.find((g) => g.id === item?.groupId) ?? null,
    [board.groups, item?.groupId],
  );

  // A subitem's cells use the board's columns too.
  const itemColumns = useMemo(
    () => [...columnsForItem(board, item ?? { parentItemId: null })] as ColumnDef[],
    [board, item],
  );
  const columns = useMemo(() => buildColumnViews(itemColumns), [itemColumns]);
  const subColumns = useMemo(
    () => buildColumnViews([...columnsForSubitems(board)] as ColumnDef[]),
    [board],
  );
  // Soft "Required" rule: only counts columns a person fills in; nothing is blocked.
  const missingRequired = useMemo(
    () => (item ? countMissingRequired(itemColumns, item.values) : 0),
    [item, itemColumns],
  );
  const { ctx, subCtx } = useItemTableCtx({ board, uid, items, boardRole });
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  // ---- Open/closed state shared with the side panel, and prev/next order
  useEffect(() => {
    useItemViewStore.getState().setOpenBoard(boardId);
    return () => useItemViewStore.getState().setOpenBoard(null);
  }, [boardId]);
  const visible = useItemViewStore((s) => s.visible[boardId]);
  const subitem = item ? isSubitem(item) : false;
  const parent = item?.parentItemId
    ? (items.find((i) => i.id === item.parentItemId) ?? null)
    : null;
  const { prev, next, index, total } = subitem
    ? subitemNeighbours(items, item!)
    : neighbours(visible, itemId);
  const what = subitem ? 'subitem' : 'item';

  const routeState = location.state as ItemViewRouteState | null;
  const fromBoard = routeState?.fromBoard === true;
  // A subitem page is reached through its parent's page, so history steps would loop back to it:
  // close goes to the board directly.
  const closeToBoard = routeState?.fromItem !== undefined || routeState?.toBoard === true;
  const close = useCallback(() => {
    if (closeToBoard) navigate(boardPath(board), { replace: true });
    else if (fromBoard) navigate(-1);
    else navigate(boardPath(board), { replace: true });
  }, [closeToBoard, fromBoard, navigate, board]);

  // Opened from the side panel's subitems row: bring the Subitems section up, once per open.
  const scrolledSection = useRef(false);
  const wantsSubitems = routeState?.section === 'subitems';
  const hasItem = item !== null;
  useEffect(() => {
    if (!wantsSubitems || !hasItem || scrolledSection.current) return;
    scrolledSection.current = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    document
      .getElementById('item-view-subitems')
      ?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [wantsSubitems, hasItem]);

  const goTo = (id: string | null) => {
    if (!id) return;
    // Stepping keeps how the page was opened (a subitem stays "from" its parent).
    navigate(itemViewPath(board, id), {
      replace: true,
      // Only how the page was opened carries over, never a notification's update or section.
      state: subitem
        ? {
            ...(routeState?.fromBoard ? FROM_BOARD_STATE : {}),
            ...(routeState?.fromItem ? { fromItem: routeState.fromItem } : {}),
          }
        : FROM_BOARD_STATE,
    });
  };
  const openSubitem = (subId: string) =>
    navigate(itemViewPath(board, subId), { state: subitemOpenState(routeState, itemId) });

  // Escape closes unless something inside owns it (an open menu, an editor, a popover).
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target instanceof Node ? event.target : null;
      const free = !target || target === document.body || target === document.documentElement;
      if (free || windowRef.current?.contains(target)) {
        const el = target instanceof HTMLElement ? target : null;
        // Escape inside a text field belongs to that field (cancel edit); the window stays.
        if (
          el &&
          el !== windowRef.current &&
          el.matches('input, textarea, [contenteditable="true"]')
        )
          return;
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);
  useEffect(() => {
    windowRef.current?.focus();
  }, [itemId]);

  // ---- Actions
  const copyLink = () => copyItemLink(board, itemId);
  const retire = async (state: 'archived' | 'deleted') => {
    if (!item) return;
    if (!(await tableActions.retireItems(ctx, [item.id], state))) return;
    // A subitem goes back to its parent's page; an item back to the board.
    if (item.parentItemId)
      navigate(itemViewPath(board, item.parentItemId), {
        replace: true,
        state: { ...(routeState?.fromBoard ? FROM_BOARD_STATE : {}), toBoard: true },
      });
    else close();
  };
  const duplicate = () => {
    if (!item) return;
    void tableActions.duplicateItems(ctx, [item], (groupId) =>
      itemsRef.current
        .filter((i) => i.groupId === groupId && !isSubitem(i))
        .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)),
    );
  };

  const saveDescription = useCallback(
    (value: DescriptionValue | null) => itemWrites.setDescription(uid, boardId, itemId, value),
    [uid, boardId, itemId],
  );

  const body = !item ? (
    <div className={styles.center} role={loading ? 'status' : undefined}>
      {loading ? <Loader size="medium" /> : <p>This item no longer exists.</p>}
    </div>
  ) : (
    <div className={styles.body} data-print="reset">
      <div className={styles.main} data-print="reset">
        <section className={styles.section} aria-label="Description">
          <h3 className={styles.sectionTitle}>Description</h3>
          <Suspense fallback={<div className={styles.editorFallback} aria-busy="true" />}>
            <DescriptionEditor
              key={item.id}
              boardId={boardId}
              itemId={item.id}
              initial={(item.description?.doc as Record<string, unknown> | undefined) ?? null}
              readOnly={!canEdit}
              onSave={saveDescription}
            />
          </Suspense>
        </section>
        {subitem ? null : (
          <ItemSubitems
            parent={item}
            items={items}
            subColumns={subColumns}
            subCtx={subCtx}
            ctx={ctx}
            canEdit={canEdit}
            onOpen={openSubitem}
          />
        )}
        <section className={styles.section} aria-label="Updates">
          <h3 className={styles.sectionTitle}>Updates</h3>
          <div className={styles.updates}>
            <UpdatesFeed
              boardId={boardId}
              itemId={item.id}
              focusUpdateId={routeState?.updateId}
              focusReplyId={routeState?.replyId}
              canManage={boardRole === 'owner'}
            />
          </div>
        </section>
      </div>
      <aside className={styles.side} aria-label="Fields panel" data-print="reset">
        <h3 className={styles.sectionTitle}>Fields</h3>
        <FieldsPanel item={item} columns={columns} ctx={subitem ? subCtx : ctx} canEdit={canEdit} />
      </aside>
    </div>
  );

  return (
    <div className={styles.overlay} data-print="item-overlay">
      <button
        type="button"
        className={styles.scrim}
        aria-label="Close item"
        data-print="hide"
        onClick={close}
      />
      <div
        ref={windowRef}
        className={styles.window}
        data-print="item-window"
        role="dialog"
        aria-modal="true"
        aria-label={item ? `${subitem ? 'Subitem' : 'Item'} ${item.name}` : 'Item'}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div className={styles.topRow}>
            <nav className={styles.crumbs} aria-label="Breadcrumb">
              <span className={styles.crumb}>{workspace?.name ?? ''}</span>
              <span aria-hidden="true">{'›'}</span>
              <span className={styles.crumb}>{board.name}</span>
              {group ? (
                <>
                  <span aria-hidden="true">{'›'}</span>
                  <span className={styles.crumb}>
                    <span
                      className={styles.groupDot}
                      style={{ '--group-color': group.color } as CSSProperties}
                      aria-hidden="true"
                    />
                    {group.title}
                  </span>
                </>
              ) : null}
              {subitem && item?.parentItemId && parent ? (
                <>
                  <span aria-hidden="true">{'›'}</span>
                  <Link
                    className={`${styles.crumb} ${styles.crumbLink}`}
                    to={itemViewPath(board, item.parentItemId)}
                    replace
                    state={{ ...(routeState?.fromBoard ? FROM_BOARD_STATE : {}), toBoard: true }}
                    aria-label={`Back to ${parent.name}`}
                    data-testid="parent-crumb"
                  >
                    {parent.name}
                  </Link>
                </>
              ) : null}
            </nav>
            <div className={styles.actions} data-print="hide">
              {total > 1 ? (
                <>
                  <Tooltip content={`Previous ${what}`}>
                    <IconButton
                      icon={NavigationChevronLeft}
                      size="small"
                      kind="tertiary"
                      aria-label={`Previous ${what}`}
                      disabled={!prev}
                      onClick={() => goTo(prev)}
                    />
                  </Tooltip>
                  <Tooltip content={`Next ${what}`}>
                    <IconButton
                      icon={NavigationChevronRight}
                      size="small"
                      kind="tertiary"
                      aria-label={`Next ${what}`}
                      disabled={!next}
                      onClick={() => goTo(next)}
                    />
                  </Tooltip>
                  <span className={styles.position} aria-hidden="true">
                    {index + 1} / {total}
                  </span>
                </>
              ) : null}
              <MenuButton
                size="small"
                aria-label={`${subitem ? 'Subitem' : 'Item'} actions`}
                closeMenuOnItemClick
              >
                <Menu id="item-view-menu" size="medium">
                  <MenuItem title="Copy link" icon={LinkIcon} onClick={copyLink} />
                  {canEdit ? (
                    <MenuItem title={`Duplicate ${what}`} icon={Duplicate} onClick={duplicate} />
                  ) : null}
                  {canEdit ? (
                    <MenuItem
                      title={`Archive ${what}`}
                      icon={Archive}
                      onClick={() => void retire('archived')}
                    />
                  ) : null}
                  {canEdit ? (
                    <MenuItem
                      title={`Delete ${what}`}
                      icon={Delete}
                      onClick={() => void retire('deleted')}
                    />
                  ) : null}
                </Menu>
              </MenuButton>
              <Tooltip content="Close">
                <IconButton
                  icon={Close}
                  size="small"
                  kind="tertiary"
                  aria-label="Close item"
                  onClick={close}
                />
              </Tooltip>
            </div>
          </div>
          {item ? (
            <InlineEdit
              value={item.name}
              readOnly={!canEdit}
              ariaLabel={subitem ? 'Subitem name' : 'Item name'}
              className={styles.title}
              maxLength={500}
              onCommit={(name) => void tableActions.renameItem(ctx, item.id, name)}
            />
          ) : null}
          {item && missingRequired > 0 ? (
            <p className={styles.requiredSummary} data-testid="required-summary">
              {missingRequired === 1
                ? '1 required field is empty'
                : `${missingRequired} required fields are empty`}
            </p>
          ) : null}
        </header>
        {body}
      </div>
    </div>
  );
}
