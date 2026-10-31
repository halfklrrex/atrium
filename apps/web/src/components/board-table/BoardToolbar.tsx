import { Button, Menu, MenuButton, MenuItem, SplitButton } from '@vibe/core';
import { Add, Close, Search } from '@vibe/icons';
import { useContext, useEffect, useRef, type ReactNode } from 'react';
import type { BoardDoc, ItemDoc } from '../../data';
import {
  AdvancedFilterPopover,
  GroupByMenuPopover,
  HideColumnsPopover,
  PersonFilterPopover,
  SortMenuPopover,
} from '../board-filters';
import { ViewSaveBar } from '../board-views/ViewSaveBar';
import { TableEnvContext } from './table-env';
import { useTableStore } from './table-store';
import styles from './table.module.css';

/** Whether the developer-only menu (seed sample data) is on: dev server and `?dev` in the address. */
function devToolsEnabled(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('dev');
}

export interface BoardToolbarProps {
  board?: BoardDoc;
  items?: ItemDoc[];
  userLookup?: (uid: string) => string | undefined;
  /**
   * `'kanban'` leaves out New item, Hide and Group by (monday's Kanban toolbar has none of them).
   * `'calendar'` has a plain New item button, and no Hide or Group by.
   */
  variant?: 'table' | 'kanban' | 'calendar';
  /** Whether "New item" is enabled in the calendar variant (the table reads its own environment). */
  canAddItem?: boolean;
  /** Extra controls after the board tools (the calendar's period navigation). */
  after?: ReactNode;
  /** Right-aligned extras (the Kanban status bar and settings gear). */
  trailing?: ReactNode;
  onNewItem?: () => void;
  onNewGroup?: () => void;
  onDev?: (action: 'seed-1000' | 'seed-roadmap') => void;
}

/** "New item" split button, working search, Person, Filter, Sort and Group by. */
export function BoardToolbar({
  board,
  items,
  userLookup,
  variant = 'table',
  canAddItem = false,
  after,
  trailing,
  onNewItem,
  onNewGroup,
  onDev,
}: BoardToolbarProps) {
  const calendar = variant === 'calendar';
  const tableOnly = variant === 'table';
  // Outside the table (the Kanban view) there is no table environment, and no New item button.
  const canEdit = useContext(TableEnvContext)?.canEdit ?? false;
  const searchOpen = useTableStore((s) => s.searchOpen);
  const search = useTableStore((s) => s.search);
  const setSearch = useTableStore((s) => s.setSearch);
  const setSearchOpen = useTableStore((s) => s.setSearchOpen);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Board tools">
      {calendar ? (
        <Button size="small" disabled={!canAddItem} onClick={onNewItem}>
          New item
        </Button>
      ) : null}
      {tableOnly ? (
        <SplitButton
          size="small"
          disabled={!canEdit}
          onClick={onNewItem}
          secondaryDialogContent={
            <Menu id="new-item-menu" size="medium">
              <MenuItem title="New group of items" icon={Add} onClick={onNewGroup} />
            </Menu>
          }
          shouldCloseOnClickInsideDialog
        >
          New item
        </SplitButton>
      ) : null}

      {searchOpen ? (
        <div className={styles.searchBox}>
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            className={styles.searchInput}
            value={search}
            placeholder="Search this board"
            aria-label="Search this board"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setSearchOpen(false);
              }
            }}
          />
          <button
            type="button"
            className={styles.searchClear}
            aria-label="Clear search"
            onClick={() => setSearchOpen(false)}
          >
            <Close aria-hidden="true" />
          </button>
        </div>
      ) : (
        <Button kind="tertiary" size="small" leftIcon={Search} onClick={() => setSearchOpen(true)}>
          Search
        </Button>
      )}

      {/* Person Filter */}
      <span className={styles.toolWrap}>
        <PersonFilterPopover board={board} items={items} userLookup={userLookup} />
      </span>

      {/* Advanced Filter */}
      <span className={styles.toolWrap}>
        <AdvancedFilterPopover board={board} userLookup={userLookup} />
      </span>

      {/* Sort Menu */}
      <span className={styles.toolWrap}>
        <SortMenuPopover board={board} />
      </span>

      {tableOnly ? (
        <>
          {/* Hide: which columns this view shows */}
          <span className={styles.toolWrap}>
            <HideColumnsPopover board={board} />
          </span>

          {/* Group by */}
          <span className={styles.toolWrap}>
            <GroupByMenuPopover board={board} />
          </span>
        </>
      ) : null}

      <ViewSaveBar />

      {after}

      {trailing ? <div className={styles.toolbarTrailing}>{trailing}</div> : null}

      {onDev && devToolsEnabled() ? (
        <MenuButton size="small" aria-label="Developer tools" closeMenuOnItemClick>
          <Menu id="dev-menu" size="medium">
            <MenuItem title="Seed 1,000 items" onClick={() => onDev('seed-1000')} />
            <MenuItem title="Seed Roadmap sample" onClick={() => onDev('seed-roadmap')} />
          </Menu>
        </MenuButton>
      ) : null}
    </div>
  );
}
