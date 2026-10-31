import { Button, Icon, Search, Skeleton, Tab, TabList } from '@vibe/core';
import { Info } from '@vibe/icons';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { EmptyMyWork } from '../components/illustrations';
import { Popover } from '../components/Popover';
import { useWorkspaces } from '../data';
import { MY_WORK_BOARD_CAP, useMyWorkItems } from '../data/my-work';
import { todayIso } from '../lib/date-grid';
import { buildRows, buildSections } from './my-work/my-work-model';
import { MyWorkTable } from './my-work/MyWorkTable';
import styles from './MyWork.module.css';

const SKELETON_ROWS = 6;

const TAB_TABLE = 0;

/**
 * `/my-work` - every item and subitem assigned to the signed-in user, on any board they can read,
 * grouped by date (read-only; a row opens the item).
 */
export function MyWorkPage() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { entries, loading, error, truncatedFrom, retry } = useMyWorkItems(uid);
  const { data: workspaces } = useWorkspaces(uid);
  const [tab, setTab] = useState(TAB_TABLE);
  const [term, setTerm] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const rows = useMemo(
    () => buildRows(entries, new Map(workspaces.map((w) => [w.id, w.name]))),
    [entries, workspaces],
  );
  const sections = useMemo(() => buildSections(rows, todayIso(), term), [rows, term]);

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

      {truncatedFrom > 0 ? (
        <p className={styles.notice} role="status">
          Showing work from {MY_WORK_BOARD_CAP} of {truncatedFrom} boards
        </p>
      ) : null}

      {error ? (
        <EmptyState
          size="page"
          className={styles.empty}
          title="Couldn't load your work"
          body="Something went wrong while loading the items assigned to you."
          primaryAction={{ label: 'Retry', onClick: retry }}
        />
      ) : loading ? (
        <div className={styles.loading} role="status" aria-label="Loading your work">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <Skeleton key={i} type="rectangle" className={styles.skeletonRow} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <>
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
                  When someone assigns you an item on any board, it appears here, so you can see
                  what is on your plate without opening each board.
                </p>
              </Popover>
            }
          />
        </>
      ) : sections.length === 0 ? (
        <EmptyState
          size="panel"
          className={styles.noMatch}
          title="No items match your search"
          body="Try a different item, board or group name."
        />
      ) : (
        <MyWorkTable sections={sections} highlight={term.trim()} />
      )}
    </div>
  );
}
