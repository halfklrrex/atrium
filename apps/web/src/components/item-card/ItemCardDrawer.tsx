import {
  canEditBoard,
  columnsForSubitems,
  hasLegacySubitemColumns,
  resolveBoardRole,
  type ColumnDef,
} from '@atrium/shared';
import {
  Button,
  IconButton,
  Loader,
  Menu,
  MenuButton,
  MenuItem,
  Tab,
  TabList,
  Tooltip,
} from '@vibe/core';
import {
  Archive,
  Close,
  Delete,
  Link as LinkIcon,
  NavigationChevronLeft,
  NavigationChevronRight,
  Open,
  Update,
} from '@vibe/icons';
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useAuth } from '../../auth/auth-context';
import { useItemActivity, type ActivityState } from '../../data/activity';
import type { BoardDoc, ItemDoc } from '../../data';
import { useBoard, useItems, useWorkspace } from '../../data/hooks';
import { updateItemName, useItem, useItemUpdates } from '../../data/updates';
import { ActivityFeed } from '../activity/ActivityFeed';
import { openItemFull } from '../board-table/open-item';
import { buildColumnViews } from '../board-table/table-model';
import { InlineEdit } from '../InlineEdit';
import { copyItemLink } from '../item-view/item-link';
import { useItemTableCtx } from '../item-view/use-item-ctx';
import { showComingSoon } from '../toast-store';
import { UserAvatar } from '../UserAvatar';
import { useItemCardStore, type ItemPanelTab } from './item-card-store';
import styles from './ItemCardDrawer.module.css';
import { ItemKeyBar } from './ItemKeyBar';
import { ItemOverview } from './ItemOverview';
import { selectKeyBarColumns } from './item-panel-layout';
import { UpdatesFeed } from './UpdatesFeed';

/** The tabs in order. Files joins this list when its tab is built. */
const PANEL_TABS: readonly { id: ItemPanelTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'updates', label: 'Updates' },
  { id: 'activity', label: 'Activity Log' },
];

export function ItemCardDrawer() {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { activeBoardId, activeItemId, closeItemCard, itemIds, setActiveItemId, tab } =
    useItemCardStore();

  // A tab the panel doesn't have yet falls back to Overview.
  const tabIndex = Math.max(
    0,
    PANEL_TABS.findIndex((t) => t.id === tab),
  );
  const activeTab = PANEL_TABS[tabIndex]?.id ?? 'overview';
  const drawerRef = useRef<HTMLElement>(null);

  const { data: item, loading: itemLoading } = useItem(
    activeBoardId ?? undefined,
    activeItemId ?? undefined,
  );
  const { data: updates } = useItemUpdates(activeBoardId ?? undefined, activeItemId ?? undefined);
  const { data: board } = useBoard(activeBoardId ?? undefined);
  const activityColumns = useMemo(
    () =>
      board
        ? [
            ...board.columns,
            // A board not yet migrated: its legacy subitem columns also label activity.
            ...(hasLegacySubitemColumns(board) ? columnsForSubitems(board) : []),
          ]
        : [],
    [board],
  );
  // Listen to the history only while its tab is showing.
  const activity = useItemActivity(
    activeTab === 'activity' ? (activeBoardId ?? undefined) : undefined,
    activeItemId ?? undefined,
  );

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Escape belongs to whatever else has focus (a cell editor, a menu); only claim it from the
      // panel itself or from nothing in particular.
      const target = e.target instanceof Node ? e.target : null;
      const free = target === document.body || target === document.documentElement || !target;
      if (free || (target && drawerRef.current?.contains(target))) closeItemCard();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeItemCard]);

  if (!activeBoardId || !activeItemId) {
    return null;
  }

  const currentIndex = itemIds.indexOf(activeItemId);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex !== -1 && currentIndex < itemIds.length - 1;

  const handlePrev = () => {
    if (hasPrev) {
      setActiveItemId(itemIds[currentIndex - 1] ?? null);
    }
  };

  const handleNext = () => {
    if (hasNext) {
      setActiveItemId(itemIds[currentIndex + 1] ?? null);
    }
  };

  // A non-modal side panel (as in monday): no backdrop, the board behind it stays interactive,
  // and only the X or Escape close it.
  return (
    <div className={styles.dock} data-print="hide">
      <aside
        ref={drawerRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="false"
        aria-label="Item card"
      >
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <Tooltip content="Close">
              <IconButton
                icon={Close}
                size="small"
                kind="tertiary"
                aria-label="Close item card"
                onClick={closeItemCard}
              />
            </Tooltip>

            {itemIds.length > 1 && (
              <div className={styles.navArrows}>
                <Tooltip content="Previous item">
                  <IconButton
                    icon={NavigationChevronLeft}
                    size="small"
                    kind="tertiary"
                    aria-label="Previous item"
                    disabled={!hasPrev}
                    onClick={handlePrev}
                  />
                </Tooltip>
                <Tooltip content="Next item">
                  <IconButton
                    icon={NavigationChevronRight}
                    size="small"
                    kind="tertiary"
                    aria-label="Next item"
                    disabled={!hasNext}
                    onClick={handleNext}
                  />
                </Tooltip>
              </div>
            )}

            <div className={styles.itemNameWrapper}>
              {itemLoading && !item ? (
                <Loader size="small" />
              ) : (
                <InlineEdit
                  value={item?.name ?? 'Item'}
                  readOnly={!uid}
                  ariaLabel="Item name"
                  className={styles.itemTitle}
                  onCommit={(nextName) => {
                    if (activeBoardId && activeItemId && uid) {
                      void updateItemName(activeBoardId, activeItemId, nextName, uid);
                    }
                  }}
                />
              )}
            </div>
          </div>

          <div className={styles.headerRight}>
            {item?.createdBy && (
              <span className={styles.creator}>
                <UserAvatar uid={item.createdBy} size="small" />
              </span>
            )}

            <Tooltip content="Open full item">
              <IconButton
                icon={Open}
                size="small"
                kind="tertiary"
                aria-label="Open full item"
                onClick={() => openItemFull(activeBoardId, activeItemId)}
              />
            </Tooltip>

            <MenuButton size="small" aria-label="Item actions" closeMenuOnItemClick>
              <Menu id="item-card-menu" size="medium">
                <MenuItem
                  title="Archive item"
                  icon={Archive}
                  onClick={() => showComingSoon('Archive item')}
                />
                <MenuItem
                  title="Delete item"
                  icon={Delete}
                  onClick={() => showComingSoon('Delete item')}
                />
              </Menu>
            </MenuButton>
          </div>
        </header>

        {board && item ? (
          <PanelBody
            board={board}
            item={item}
            uid={uid}
            activeTab={activeTab}
            tabIndex={tabIndex}
            updatesCount={updates.length}
            activity={activity}
            activityColumns={activityColumns}
          />
        ) : (
          <div className={styles.contentArea}>
            <div className={styles.center} role={itemLoading ? 'status' : undefined}>
              {itemLoading || !board ? <Loader size="small" /> : <p>This item no longer exists.</p>}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

interface PanelBodyProps {
  board: BoardDoc;
  item: ItemDoc;
  uid: string;
  activeTab: ItemPanelTab;
  tabIndex: number;
  updatesCount: number;
  activity: ActivityState;
  activityColumns: readonly ColumnDef[];
}

/** Everything under the header: crumb, key bar, tabs, the tab's content and the footer. */
function PanelBody({
  board,
  item,
  uid,
  activeTab,
  tabIndex,
  updatesCount,
  activity,
  activityColumns,
}: PanelBodyProps) {
  const setTab = useItemCardStore((s) => s.setTab);
  const { data: workspace } = useWorkspace(board.workspaceId);
  const { data: items } = useItems(board.id);
  const boardRole = resolveBoardRole(board, uid, workspace?.roles[uid]);
  const canEdit = canEditBoard(boardRole);
  const { ctx } = useItemTableCtx({ board, uid, items, boardRole });
  const columns = useMemo(() => buildColumnViews(board.columns), [board.columns]);
  const keySlots = useMemo(() => selectKeyBarColumns(columns), [columns]);
  const keyBarIds = useMemo(() => new Set(keySlots.map((k) => k.column.def.id)), [keySlots]);
  const group = board.groups.find((g) => g.id === item.groupId) ?? null;
  const tabLabel = PANEL_TABS[tabIndex]?.label ?? '';

  return (
    <>
      <p className={styles.crumb}>
        {group ? (
          <>
            <span
              className={styles.groupDot}
              style={{ '--group-color': group.color } as CSSProperties}
              aria-hidden="true"
            />
            <span className={styles.crumbText}>{group.title}</span>
            <span aria-hidden="true">{' · '}</span>
          </>
        ) : null}
        <span className={styles.crumbText}>{board.name}</span>
      </p>

      <ItemKeyBar item={item} slots={keySlots} ctx={ctx} canEdit={canEdit} />

      <div className={styles.tabsContainer}>
        <TabList
          activeTabId={tabIndex}
          onTabChange={(index) => setTab(PANEL_TABS[index]?.id ?? 'overview')}
          stretchedUnderline
        >
          <Tab>Overview</Tab>
          <Tab icon={Update} className={styles.updatesTab}>
            {updatesCount > 0 ? `Updates / ${updatesCount}` : 'Updates'}
          </Tab>
          <Tab>
            <span>
              Activity <span className={styles.tabLabelTail}>Log</span>
            </span>
          </Tab>
        </TabList>
      </div>

      <div className={styles.contentArea} role="tabpanel" aria-label={tabLabel}>
        {activeTab === 'overview' && (
          <ItemOverview
            key={item.id}
            board={board}
            item={item}
            uid={uid}
            columns={columns}
            keyBarIds={keyBarIds}
            ctx={ctx}
            canEdit={canEdit}
          />
        )}

        {activeTab === 'updates' && (
          <UpdatesFeed boardId={board.id} itemId={item.id} canManage={boardRole === 'owner'} />
        )}

        {activeTab === 'activity' && (
          <ActivityFeed
            state={activity}
            columns={activityColumns}
            emptyBody="Changes to this item will show up here as they happen."
            label="Item activity"
          />
        )}
      </div>

      {activeTab === 'overview' ? (
        <footer className={styles.footer}>
          <Button
            kind="tertiary"
            size="small"
            leftIcon={LinkIcon}
            onClick={() => copyItemLink(board, item.id)}
          >
            Copy link
          </Button>
          <Button
            kind="secondary"
            size="small"
            leftIcon={Open}
            onClick={() => openItemFull(board.id, item.id)}
          >
            Open full item
          </Button>
        </footer>
      ) : null}
    </>
  );
}
