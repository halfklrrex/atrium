import type { AutomationRunStatus } from '@atrium/shared';
import type { AutomationRunDoc } from '../../data/automations';

export const RUN_STATUS_LABELS: Record<AutomationRunStatus, string> = {
  ok: 'OK',
  skipped: 'Skipped',
  failed: 'Failed',
};

/** The newest run of each recipe. `runs` is newest first (the history query's order). */
export function lastRunByAutomation(
  runs: readonly AutomationRunDoc[],
): Map<string, AutomationRunDoc> {
  const last = new Map<string, AutomationRunDoc>();
  for (const run of runs) if (!last.has(run.automationId)) last.set(run.automationId, run);
  return last;
}

export interface RunFilters {
  /** A recipe id, or `null` for all. */
  automationId: string | null;
  status: AutomationRunStatus | null;
}

/** Client-side filters over the loaded runs (the query has no composite index). */
export function filterRuns(
  runs: readonly AutomationRunDoc[],
  filters: RunFilters,
): AutomationRunDoc[] {
  return runs.filter(
    (run) =>
      (filters.automationId === null || run.automationId === filters.automationId) &&
      (filters.status === null || run.status === filters.status),
  );
}

/** The one line a run shows next to its status: why it was skipped or how it failed. */
export function runDetail(run: Pick<AutomationRunDoc, 'status' | 'reason' | 'error'>): string {
  if (run.status === 'failed') return run.error ?? run.reason ?? '';
  return run.reason ?? run.error ?? '';
}
