import { Button, Menu, MenuButton, MenuItem, SplitButton, Tooltip } from '@vibe/core';
import { Add, Close, Hide, Search } from '@vibe/icons';
import { useEffect, useRef } from 'react';
import type { BoardDoc, ItemDoc } from '../../data';
import {
  AdvancedFilterPopover,
  GroupByMenuPopover,
  PersonFilterPopover,
  SortMenuPopover,
} from '../board-filters';
import { useTableEnv } from './table-env';
import { useTableStore } from './table-store';
import styles from './table.module.css';

const SOON = 'Coming soon';

/** Whether the developer-only menu (seed sample data) is on: dev server and `?dev` in the address. */
function devToolsEnabled(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('dev');
}

export interface BoardToolbarProps {
  board?: BoardDoc;
  items?: ItemDoc[];
  userLookup?: (uid: string) => string | undefined;
  onNewItem: () => void;
  onNewGroup: () => void;
  onDev?: (action: 'seed-1000' | 'seed-roadmap') => void;
}

/** "New item" split button, working search, Person, Filter, Sort and Group by. */
export function BoardToolbar({
  board,
  items,
  userLookup,
  onNewItem,
  onNewGroup,
  onDev,
}: BoardToolbarProps) {
  const env = useTableEnv();
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
      <SplitButton
        size="small"
        disabled={!env.canEdit}
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

      {/* Hide (placeholder) */}
      <Tooltip content={SOON}>
        <span className={styles.toolWrap}>
          <Button kind="tertiary" size="small" leftIcon={Hide} disabled>
            Hide
          </Button>
        </span>
      </Tooltip>

      {/* Group by */}
      <span className={styles.toolWrap}>
        <GroupByMenuPopover board={board} />
      </span>

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
