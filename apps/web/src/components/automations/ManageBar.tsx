import { AUTOMATION_LIMITS } from '@atrium/shared';
import { Button, Search, Tab, TabList } from '@vibe/core';
import { Add } from '@vibe/icons';
import styles from './ManageBar.module.css';

export type ManageTab = 'recipes' | 'history';

export interface ManageBarProps {
  tab: ManageTab;
  onTabChange: (tab: ManageTab) => void;
  /** How many automations the board has. */
  count: number;
  /** Board owners get the create button. */
  isOwner: boolean;
  search: string;
  onSearchChange: (term: string) => void;
  onCreate: () => void;
}

/**
 * The Manage row: the "Board automations (N)" and "Run history" sub-tabs on the left; on the right
 * the "N of 20 used" count, the search (Board automations only) and the create button.
 */
export function ManageBar({
  tab,
  onTabChange,
  count,
  isOwner,
  search,
  onSearchChange,
  onCreate,
}: ManageBarProps) {
  const max = AUTOMATION_LIMITS.maxPerBoard;
  return (
    <div className={styles.bar}>
      <TabList
        activeTabId={tab === 'recipes' ? 0 : 1}
        onTabChange={(id: number) => onTabChange(id === 0 ? 'recipes' : 'history')}
      >
        <Tab>{`Board automations (${count})`}</Tab>
        <Tab>Run history</Tab>
      </TabList>
      {isOwner ? (
        <div className={styles.right}>
          <span className={styles.usage}>{`${count} of ${max} used`}</span>
          {tab === 'recipes' && count > 0 ? (
            <div className={styles.search}>
              <Search
                value={search}
                onChange={onSearchChange}
                placeholder="Search automations"
                inputAriaLabel="Search automations"
                size="small"
              />
            </div>
          ) : null}
          <Button
            kind="primary"
            size="small"
            leftIcon={Add}
            disabled={count >= max}
            onClick={onCreate}
          >
            Create automation
          </Button>
        </div>
      ) : null}
    </div>
  );
}
