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

/**
 * "Today 14:32", "Yesterday 17:18", otherwise "Nov 3, 15:11" (24-hour clock, local time). Takes any
 * timestamp-like with `toMillis()`.
 */
export function formatRunTime(
  timestamp: { toMillis(): number },
  now: number = Date.now(),
  locale?: string,
): string {
  const at = new Date(timestamp.toMillis());
  const time = at.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(at)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${at.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** The one line a run shows next to its status: why it was skipped or how it failed. */
export function runDetail(run: Pick<AutomationRunDoc, 'status' | 'reason' | 'error'>): string {
  if (run.status === 'failed') return run.error ?? run.reason ?? '';
  return run.reason ?? run.error ?? '';
}

export interface ScheduledRunInfo {
  kind: 'recurring' | 'date';
  /** "Scheduled for ..." with the instant (recurring) or the date (date arrives) the run was for. */
  label: string;
}

/**
 * Whether the scheduler started this run (P5d) and for when. Scheduler runs have deterministic ids
 * `recurring:<automationId>:<scheduledForISO>` and `date:<automationId>:<itemId>:<YYYY-MM-DD>`
 * (the same text may sit in `eventId`). Anything that does not parse still reads "Scheduled".
 */
export function scheduledRunInfo(
  run: Pick<AutomationRunDoc, 'id' | 'eventId'>,
): ScheduledRunInfo | null {
  const key = [run.id, run.eventId].find((v) => /^(recurring|date):/.test(v ?? ''));
  if (!key) return null;
  if (key.startsWith('recurring:')) {
    const iso = key.split(':').slice(2).join(':');
    const at = new Date(iso);
    return {
      kind: 'recurring',
      label: Number.isNaN(at.getTime())
        ? 'Scheduled'
        : `Scheduled for ${at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
    };
  }
  const day = key.split(':').at(-1) ?? '';
  return {
    kind: 'date',
    label: /^\d{4}-\d{2}-\d{2}$/.test(day) ? `Scheduled for ${day}` : 'Scheduled',
  };
}
