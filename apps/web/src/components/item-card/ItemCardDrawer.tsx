import { IconButton, Loader, Menu, MenuButton, MenuItem, Tab, TabList, Tooltip } from '@vibe/core';
import {
  Archive,
  Close,
  Delete,
  NavigationChevronLeft,
  NavigationChevronRight,
  Update,
} from '@vibe/icons';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/auth-context';
import { updateItemName, useItem, useItemUpdates } from '../../data/updates';
import { formatUpdated } from '../../lib/format';
import { InlineEdit } from '../InlineEdit';
import { showComingSoon } from '../toast-store';
import { UserAvatar } from '../UserAvatar';
import { useItemCardStore } from './item-card-store';
import styles from './ItemCardDrawer.module.css';
import { UpdatesFeed } from './UpdatesFeed';

const TAB_UPDATES = 0;
const TAB_ACTIVITY = 1;

export function ItemCardDrawer() {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const { activeBoardId, activeItemId, closeItemCard, itemIds, setActiveItemId } =
    useItemCardStore();

  const [activeTab, setActiveTab] = useState(TAB_UPDATES);
  const drawerRef = useRef<HTMLElement>(null);

  const { data: item, loading: itemLoading } = useItem(
    activeBoardId ?? undefined,
    activeItemId ?? undefined,
  );
  const { data: updates } = useItemUpdates(activeBoardId ?? undefined, activeItemId ?? undefined);

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
    <div className={styles.dock}>
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
            {item?.createdBy && <UserAvatar uid={item.createdBy} size="small" />}

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

        {/* Tabs */}
        <div className={styles.tabsContainer}>
          <TabList activeTabId={activeTab} onTabChange={setActiveTab} stretchedUnderline>
            <Tab icon={Update}>
              {updates.length > 0 ? `Updates / ${updates.length}` : 'Updates'}
            </Tab>
            <Tab>Activity Log</Tab>
          </TabList>
        </div>

        {/* Content Area */}
        <div className={styles.contentArea}>
          {activeTab === TAB_UPDATES && (
            <UpdatesFeed boardId={activeBoardId} itemId={activeItemId} />
          )}

          {activeTab === TAB_ACTIVITY && (
            <div className={styles.activityLog}>
              <div className={styles.activityEntry}>
                {item?.createdBy && <UserAvatar uid={item.createdBy} size="small" />}
                <div className={styles.activityMeta}>
                  <span className={styles.activityText}>
                    <strong>Item created</strong> by{' '}
                    {item?.createdBy === uid ? 'you' : 'a team member'}
                  </span>
                  <span className={styles.activityTime}>
                    {item?.createdAt ? formatUpdated(item.createdAt) : 'Recently'}
                  </span>
                </div>
              </div>

              {updates.map((update) => (
                <div key={update.id} className={styles.activityEntry}>
                  <UserAvatar
                    uid={update.authorId}
                    name={update.authorName}
                    photoURL={update.authorPhotoUrl}
                    size="small"
                  />
                  <div className={styles.activityMeta}>
                    <span className={styles.activityText}>
                      <strong>Update posted:</strong> &quot;
                      {update.content.length > 60
                        ? `${update.content.slice(0, 60)}...`
                        : update.content}
                      &quot;
                    </span>
                    <span className={styles.activityTime}>{formatUpdated(update.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
