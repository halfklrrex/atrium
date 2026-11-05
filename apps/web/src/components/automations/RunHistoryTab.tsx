import {
  AUTOMATION_LIMITS,
  AUTOMATION_RUN_STATUSES,
  type AutomationRunStatus,
} from '@atrium/shared';
import { Dropdown, Label, Loader } from '@vibe/core';
import { useMemo, useState } from 'react';
import type { AutomationDoc, AutomationRunDoc } from '../../data/automations';
import { AUTOMATION_RUNS_LIMIT } from '../../data/automations';
import { useItems } from '../../data';
import { formatUpdated } from '../../lib/format';
import { EmptyState } from '../EmptyState/EmptyState';
import { NoSearchResults } from '../illustrations';
import {
  describeAutomation,
  type DescribeBoard,
  type DescribeOptions,
} from './describe-automation';
import { RUN_STATUS_LABELS, filterRuns, runDetail } from './run-history';
import styles from './AutomationCenter.module.css';

type Option = { value: string; label: string };

const STATUS_OPTIONS: Option[] = AUTOMATION_RUN_STATUSES.map((value) => ({
  value,
  label: RUN_STATUS_LABELS[value],
}));

const LABEL_COLOR: Record<AutomationRunStatus, 'positive' | 'negative' | 'dark'> = {
  ok: 'positive',
  failed: 'negative',
  skipped: 'dark',
};

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
    () =>
      automations.map((a) => ({
        value: a.id,
        label: a.name.trim() || describeAutomation(a, board, describeOptions),
      })),
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
  if (runs.length === 0) {
    return (
      <EmptyState
        size="panel"
        title="No runs yet"
        body="When an automation runs, it will show up here with what happened."
      />
    );
  }

  return (
    <>
      <div className={styles.filters}>
        <div className={styles.filter}>
          <Dropdown
            size="small"
            placeholder="Automation"
            aria-label="Filter by automation"
            options={recipeOptions}
            value={recipeOptions.find((o) => o.value === automationId)}
            clearable
            onChange={(selected: unknown) =>
              setAutomationId((selected as Option | null)?.value ?? null)
            }
            onClear={() => setAutomationId(null)}
          />
        </div>
        <div className={styles.filter}>
          <Dropdown
            size="small"
            placeholder="Status"
            aria-label="Filter by status"
            searchable={false}
            options={STATUS_OPTIONS}
            value={STATUS_OPTIONS.find((o) => o.value === status)}
            clearable
            onChange={(selected: unknown) =>
              setStatus(((selected as Option | null)?.value ?? null) as AutomationRunStatus | null)
            }
            onClear={() => setStatus(null)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          size="panel"
          illustration={hasFilters ? <NoSearchResults /> : undefined}
          title="No runs match these filters"
          body="Try a different automation or status."
          primaryAction={{
            label: 'Clear filters',
            onClick: () => {
              setAutomationId(null);
              setStatus(null);
            },
          }}
        />
      ) : (
        <div>
          <div className={styles.runHeader} aria-hidden="true">
            <span>When</span>
            <span>Automation</span>
            <span>Item</span>
            <span>Result</span>
            <span>Details</span>
          </div>
          <ul className={styles.list} aria-label="Run history">
            {filtered.map((run) => {
              const itemName = run.itemId ? itemNames.get(run.itemId) : undefined;
              const cells = (
                <>
                  <span className={styles.cell} title={run.startedAt.toDate().toLocaleString()}>
                    {formatUpdated(run.startedAt)}
                  </span>
                  <span className={styles.cell}>{recipeName(run.automationId)}</span>
                  <span className={styles.cell}>
                    {run.itemId ? (itemName ?? 'Deleted item') : 'No item'}
                  </span>
                  <span>
                    <Label
                      text={RUN_STATUS_LABELS[run.status]}
                      color={LABEL_COLOR[run.status]}
                      size="small"
                      kind="line"
                    />
                  </span>
                  <span className={styles.detail}>{runDetail(run)}</span>
                </>
              );
              return (
                <li key={run.id} className={styles.runItem}>
                  {run.itemId && itemName !== undefined ? (
                    <button
                      type="button"
                      className={styles.runRow}
                      onClick={() => onOpenItem(run.itemId as string)}
                    >
                      {cells}
                    </button>
                  ) : (
                    <div className={styles.runRow}>{cells}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className={styles.footnote}>
        {`Showing the latest ${AUTOMATION_RUNS_LIMIT} runs. Runs are kept for ${AUTOMATION_LIMITS.runTtlDays} days.`}
      </p>
    </>
  );
}
