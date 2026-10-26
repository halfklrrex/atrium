import { canEditBoard, isSubitem, resolveBoardRole } from '@atrium/shared';
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
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../auth/auth-context';
import { itemWrites, useItems, useWorkspace, type BoardDoc } from '../../data';
import { tableActions, type TableCtx } from '../board-table/table-actions';
import { buildColumnViews } from '../board-table/table-model';
import { UpdatesFeed } from '../item-card/UpdatesFeed';
import { InlineEdit } from '../InlineEdit';
import { showToast } from '../toast-store';
import { FieldsPanel } from './FieldsPanel';
import { ItemSubitems } from './ItemSubitems';
import type { DescriptionValue } from './description';
import { FROM_BOARD_STATE, itemViewPath, neighbours, useItemViewStore } from './item-view-store';
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
  const canEdit = canEditBoard(resolveBoardRole(board, uid, workspace?.roles[uid]));
  const item = useMemo(() => items.find((i) => i.id === itemId) ?? null, [items, itemId]);
  const group = useMemo(
    () => board.groups.find((g) => g.id === item?.groupId) ?? null,
    [board.groups, item?.groupId],
  );

  const columns = useMemo(() => buildColumnViews(board.columns), [board.columns]);
  const subitemColumns = useMemo(
    () => buildColumnViews(board.subitemColumns ?? []),
    [board.subitemColumns],
  );
  const itemsRef = useRef(items);
  const groupsRef = useRef(board.groups);
  useEffect(() => {
    itemsRef.current = items;
    groupsRef.current = board.groups;
  });
  const ctx = useMemo<TableCtx>(
    () => ({
      boardId,
      uid,
      columns: board.columns,
      subitemColumns: board.subitemColumns ?? [],
      getItems: () => itemsRef.current,
      getGroups: () => groupsRef.current,
    }),
    [boardId, uid, board.columns, board.subitemColumns],
  );
  const subCtx = useMemo<TableCtx>(
    () => ({ ...ctx, columns: board.subitemColumns ?? [], scope: 'subitems' }),
    [ctx, board.subitemColumns],
  );

  // ---- Open/closed state shared with the side panel, and prev/next order
  useEffect(() => {
    useItemViewStore.getState().setOpenBoard(boardId);
    return () => useItemViewStore.getState().setOpenBoard(null);
  }, [boardId]);
  const visible = useItemViewStore((s) => s.visible[boardId]);
  const { prev, next, index, total } = neighbours(visible, itemId);

  const fromBoard = (location.state as { fromBoard?: boolean } | null)?.fromBoard === true;
  const close = useCallback(() => {
    if (fromBoard) navigate(-1);
    else navigate(`/boards/${boardId}`, { replace: true });
  }, [fromBoard, navigate, boardId]);

  const goTo = (id: string | null) => {
    if (id) navigate(itemViewPath(boardId, id), { replace: true, state: FROM_BOARD_STATE });
  };

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
  const copyLink = () => {
    const url = `${window.location.origin}${itemViewPath(boardId, itemId)}`;
    navigator.clipboard.writeText(url).then(
      () => showToast('Link copied.', { type: 'positive' }),
      () => showToast('Could not copy the link.', { type: 'negative' }),
    );
  };
  const retire = async (state: 'archived' | 'deleted') => {
    if (!item) return;
    if (await tableActions.retireItems(ctx, [item.id], state)) close();
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
    <div className={styles.body}>
      <div className={styles.main}>
        <section className={styles.section} aria-label="Description">
          <h3 className={styles.sectionTitle}>Description</h3>
          <Suspense fallback={<div className={styles.editorFallback} aria-busy="true" />}>
            <DescriptionEditor
              key={item.id}
              initial={(item.description?.doc as Record<string, unknown> | undefined) ?? null}
              readOnly={!canEdit}
              onSave={saveDescription}
            />
          </Suspense>
        </section>
        <ItemSubitems
          parent={item}
          items={items}
          subitemColumns={subitemColumns}
          subCtx={subCtx}
          ctx={ctx}
          canEdit={canEdit}
        />
        <section className={styles.section} aria-label="Updates">
          <h3 className={styles.sectionTitle}>Updates</h3>
          <div className={styles.updates}>
            <UpdatesFeed boardId={boardId} itemId={item.id} />
          </div>
        </section>
      </div>
      <aside className={styles.side} aria-label="Fields panel">
        <h3 className={styles.sectionTitle}>Fields</h3>
        <FieldsPanel item={item} columns={columns} ctx={ctx} canEdit={canEdit} />
      </aside>
    </div>
  );

  return (
    <div className={styles.overlay}>
      <button type="button" className={styles.scrim} aria-label="Close item" onClick={close} />
      <div
        ref={windowRef}
        className={styles.window}
        role="dialog"
        aria-modal="true"
        aria-label={item ? `Item ${item.name}` : 'Item'}
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
            </nav>
            <div className={styles.actions}>
              {total > 1 ? (
                <>
                  <Tooltip content="Previous item">
                    <IconButton
                      icon={NavigationChevronLeft}
                      size="small"
                      kind="tertiary"
                      aria-label="Previous item"
                      disabled={!prev}
                      onClick={() => goTo(prev)}
                    />
                  </Tooltip>
                  <Tooltip content="Next item">
                    <IconButton
                      icon={NavigationChevronRight}
                      size="small"
                      kind="tertiary"
                      aria-label="Next item"
                      disabled={!next}
                      onClick={() => goTo(next)}
                    />
                  </Tooltip>
                  <span className={styles.position} aria-hidden="true">
                    {index + 1} / {total}
                  </span>
                </>
              ) : null}
              <MenuButton size="small" aria-label="Item actions" closeMenuOnItemClick>
                <Menu id="item-view-menu" size="medium">
                  <MenuItem title="Copy link" icon={LinkIcon} onClick={copyLink} />
                  {canEdit ? (
                    <MenuItem title="Duplicate item" icon={Duplicate} onClick={duplicate} />
                  ) : null}
                  {canEdit ? (
                    <MenuItem
                      title="Archive item"
                      icon={Archive}
                      onClick={() => void retire('archived')}
                    />
                  ) : null}
                  {canEdit ? (
                    <MenuItem
                      title="Delete item"
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
              ariaLabel="Item name"
              className={styles.title}
              maxLength={500}
              onCommit={(name) => void tableActions.renameItem(ctx, item.id, name)}
            />
          ) : null}
        </header>
        {body}
      </div>
    </div>
  );
}
