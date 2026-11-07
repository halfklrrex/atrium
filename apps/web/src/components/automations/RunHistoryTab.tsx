import {
  AUTOMATION_LIMITS,
  AUTOMATION_RUN_STATUSES,
  type AutomationRunStatus,
} from '@atrium/shared';
import { Dropdown, Loader } from '@vibe/core';
import { useMemo, useState } from 'react';
import type { AutomationDoc, AutomationRunDoc } from '../../data/automations';
import { AUTOMATION_RUNS_LIMIT } from '../../data/automations';
import { useItems } from '../../data';
import { EmptyState } from '../EmptyState/EmptyState';
import { NoSearchResults } from '../illustrations';
import {
  describeAutomation,
  type DescribeBoard,
  type DescribeOptions,
} from './describe-automation';
import {
  RUN_STATUS_LABELS,
  filterRuns,
  formatRunTime,
  runDetail,
  scheduledRunInfo,
} from './run-history';
import { RunStatusChip } from './RunStatusChip';
import styles from './AutomationCenter.module.css';

type Option = { value: string; label: string };

const ALL_AUTOMATIONS: Option = { value: '', label: 'All automations' };
const ALL_RESULTS: Option = { value: '', label: 'All results' };

const STATUS_OPTIONS: Option[] = [
  ALL_RESULTS,
  ...AUTOMATION_RUN_STATUSES.map((value) => ({ value, label: RUN_STATUS_LABELS[value] })),
];

export interface RunHistoryTabProps {
  boardId: string;
  isOwner: boolean;
  runs: readonly AutomationRunDoc[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  automations: readonly AutomationDoc[];
  board: DescribeBoard;
  describeOptions: DescribeOptions;
  onOpenItem: (itemId: string) => void;
}

/** The Run history tab: filters, the rows, and the states. Owners only. */
export function RunHistoryTab(props: RunHistoryTabProps) {
  if (!props.isOwner) {
    return (
      <EmptyState
        size="panel"
        title="You don't have access to the run history"
        body="Only board owners can see when automations ran and what happened."
      />
    );
  }
  return <OwnerRunHistory {...props} />;
}

function OwnerRunHistory({
  boardId,
  runs,
  loading,
  error,
  onRetry,
  automations,
  board,
  describeOptions,
  onOpenItem,
}: RunHistoryTabProps) {
  const [automationId, setAutomationId] = useState<string | null>(null);
  const [status, setStatus] = useState<AutomationRunStatus | null>(null);
  // Only mounted on this tab, so the items listener runs while the history is being read.
  const { data: items } = useItems(boardId);
  const itemNames = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items]);

  const recipeName = (id: string): string => {
    const automation = automations.find((a) => a.id === id);
    if (!automation) return 'Deleted automation';
    return automation.name.trim() || describeAutomation(automation, board, describeOptions);
  };
  const recipeOptions = useMemo<Option[]>(
    () => [
      ALL_AUTOMATIONS,
      ...automations.map((a) => ({
        value: a.id,
        label: a.name.trim() || describeAutomation(a, board, describeOptions),
      })),
    ],
    [automations, board, describeOptions],
  );
  const filtered = useMemo(
    () => filterRuns(runs, { automationId, status }),
    [runs, automationId, status],
  );
  const hasFilters = automationId !== null || status !== null;

  if (loading) {
    return (
      <div className={styles.center} role="status" aria-label="Loading run history">
        <Loader size="medium" />
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        size="panel"
        title="The run history is unavailable"
        body="We couldn't load the run history. Check your connection and try again."
        primaryAction={{ label: 'Retry', onClick: onRetry }}
      />
    );
  }

  const toolbar = (
    <div className={styles.filters}>
      <div className={styles.filterWide}>
        <Dropdown
          size="small"
          aria-label="Filter by automation"
          options={recipeOptions}
          value={recipeOptions.find((o) => o.value === (automationId ?? ''))}
          clearable={false}
          onChange={(selected: unknown) =>
            setAutomationId((selected as Option | null)?.value || null)
          }
        />
      </div>
      <div className={styles.filter}>
        <Dropdown
          size="small"
          aria-label="Filter by result"
          searchable={false}
          options={STATUS_OPTIONS}
          value={STATUS_OPTIONS.find((o) => o.value === (status ?? ''))}
          clearable={false}
          onChange={(selected: unknown) =>
            setStatus(((selected as Option | null)?.value || null) as AutomationRunStatus | null)
          }
        />
      </div>
      <span className={styles.meta}>{`Last ${AUTOMATION_LIMITS.runTtlDays} days`}</span>
    </div>
  );

  if (runs.length === 0) {
    return (
      <>
        {toolbar}
        <EmptyState
          size="panel"
          illustration={<NoSearchResults />}
          title="No runs to show"
          body={
            automations.length > 0
              ? 'Change the filters, or wait for a trigger: runs appear here within a few seconds.'
              : 'Runs appear here once an automation does something.'
          }
        />
      </>
    );
  }

  return (
    <>
      {toolbar}
      {filtered.length === 0 ? (
        <EmptyState
          size="panel"
          illustration={hasFilters ? <NoSearchResults /> : undefined}
          title="No runs match these filters"
          body="Try a different automation or result."
          primaryAction={{
            label: 'Clear filters',
            onClick: () => {
              setAutomationId(null);
              setStatus(null);
            },
          }}
        />
      ) : (
        <table className={styles.table} aria-label="Run history">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Automation</th>
              <th scope="col">Item</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((run) => {
              const itemName = run.itemId ? itemNames.get(run.itemId) : undefined;
              const scheduled = scheduledRunInfo(run);
              const detail = runDetail(run);
              return (
                <tr key={run.id} className={styles.tableRow}>
                  <td
                    className={styles.meta}
                    title={
                      scheduled
                        ? `${scheduled.label}. Ran ${run.startedAt.toDate().toLocaleString()}`
                        : run.startedAt.toDate().toLocaleString()
                    }
                  >
                    {formatRunTime(run.startedAt)}
                  </td>
                  <td className={styles.runRecipe}>{recipeName(run.automationId)}</td>
                  <td>
                    {run.itemId && itemName !== undefined ? (
                      <button
                        type="button"
                        className={styles.itemLink}
                        onClick={() => onOpenItem(run.itemId as string)}
                      >
                        {itemName}
                      </button>
                    ) : (
                      <span className={styles.meta}>
                        {run.itemId ? 'Deleted item' : (scheduled?.label ?? 'Scheduled')}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={styles.result}>
                      <RunStatusChip status={run.status} />
                      {detail ? <span className={styles.meta}>{detail}</span> : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {runs.length >= AUTOMATION_RUNS_LIMIT ? (
        <p className={styles.footnote}>
          {`Showing the latest ${AUTOMATION_RUNS_LIMIT} runs. Runs are kept for ${AUTOMATION_LIMITS.runTtlDays} days.`}
        </p>
      ) : null}
    </>
  );
}
