import { Button, Icon, Search, Tab, TabList } from '@vibe/core';
import { Info } from '@vibe/icons';
import { useState } from 'react';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { EmptyMyWork } from '../components/illustrations';
import { Popover } from '../components/Popover';
import styles from './MyWork.module.css';

const TAB_TABLE = 0;

/**
 * `/my-work` - monday's "My Work" shell with its empty state, until items and people columns
 * exist (P1b / P4).
 */
export function MyWorkPage() {
  const [tab, setTab] = useState(TAB_TABLE);
  const [term, setTerm] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>My work</h1>
        <Icon icon={Info} size={16} className={styles.info} />
      </header>

      <div className={styles.tabs}>
        <TabList activeTabId={tab} onTabChange={setTab} size="sm">
          <Tab>Table</Tab>
          <Tab disabled>Calendar</Tab>
        </TabList>
      </div>

      <div className={styles.toolbar}>
        <Button size="small" kind="secondary" disabled>
          New item
        </Button>
        <div className={styles.search}>
          <Search
            value={term}
            onChange={setTerm}
            placeholder="Search"
            inputAriaLabel="Search my work"
            size="small"
          />
        </div>
      </div>

      <EmptyState
        size="page"
        className={styles.empty}
        illustration={<EmptyMyWork />}
        title="This is your home base"
        body="Items assigned to you on any board will show up here."
        primaryAction={
          <Popover
            open={helpOpen}
            onClose={() => setHelpOpen(false)}
            label="About My work"
            className={styles.help}
            panelClassName={styles.helpPanel}
            trigger={
              <button
                type="button"
                className={styles.learn}
                aria-haspopup="dialog"
                aria-expanded={helpOpen}
                onClick={() => setHelpOpen((v) => !v)}
              >
                Learn about My work
              </button>
            }
          >
            <p className={styles.helpTitle}>Everything assigned to you, in one place</p>
            <p className={styles.helpBody}>
              When someone assigns you an item on any board, it appears here, so you can see what is
              on your plate without opening each board. Assigning items arrives with the board table
              and people columns.
            </p>
          </Popover>
        }
      />
    </div>
  );
}
