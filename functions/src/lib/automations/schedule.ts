import {
  addDaysToDate,
  computeNextRunAt,
  dateArrivesTargetDate,
  dateRunId,
  localDateInZone,
  recurringRunId,
} from '@atrium/shared';
import type { NotificationStore } from '../notifications';
import {
  deliver,
  runAutomation,
  type AutomationDoc,
  type AutomationStore,
  type RunOutcome,
} from './run';

/**
 * The time-based automation scheduler (P5d, spec docs/specs/P5d-time-based-automations.md).
 * `runTimeAutomations` calls `runTick` every 5 minutes. Everything here is pure logic over the
 * `SchedulerStore` port plus the runner's own ports (`AutomationStore`); `admin-scheduler.ts`
 * adapts the Admin SDK.
 *
 * - Recurring: due recipes (`nextRunAt <= now`) are claimed inside the runner's transaction, which
 *   moves `nextRunAt` forward together with the run record. Several missed occurrences (an outage)
 *   run ONCE, for the latest one; an occurrence older than the catch-up cap is only recorded as
 *   `skipped`.
 * - Date arrives: each enabled recipe looks up the items whose date cell holds its target date, for
 *   every local day of the window `(lastTickAt, now]`, and runs those whose time of day has come.
 *   The run id (`dateRunId`) makes a date fire once per recipe and item, however often it is edited.
 * - Both go through `runAutomation`: permissions of `runAs`, hourly rate limit, circuit breaker,
 *   `skipped` records. Depth is always 0.
 */

export const TICK_INTERVAL_MS = 5 * 60 * 1000;
/** A long outage replays at most this far back, so it cannot create a flood. */
export const CATCH_UP_CAP_MS = 24 * 60 * 60 * 1000;
/** Time of day of a `date_arrives` recipe with no `at`, on a date cell with no time. */
export const DEFAULT_DATE_TIME = '09:00';
/** Items a single date lookup reads at most. */
export const DATE_LOOKUP_LIMIT = 500;

/** A recipe found by a collection-group query. */
export interface ScheduledRecipe {
  boardId: string;
  automation: AutomationDoc;
}

/** An active main item whose date cell holds the looked-up date. */
export interface DateItem {
  id: string;
  name: string;
  values: Record<string, unknown>;
}

export interface SchedulerStore {
  /** `lastTickAt` of `system/automationScheduler`, in epoch ms; `null` before the first tick. */
  getLastTickMs(): Promise<number | null>;
  setLastTickMs(ms: number): Promise<void>;
  /** Enabled `recurring` recipes with `nextRunAt <= nowMs`. */
  listDueRecurring(nowMs: number): Promise<ScheduledRecipe[]>;
  /** Every enabled `date_arrives` recipe. */
  listDateArrivesRecipes(): Promise<ScheduledRecipe[]>;
  /**
   * Active (not archived, not trashed) main items of the board with `dateKey` (`"<col>:<date>"`) in
   * their `dateKeys`, at most `limit`.
   */
  listItemsByDateKey(boardId: string, dateKey: string, limit: number): Promise<DateItem[]>;
}

export interface TickDeps {
  store: SchedulerStore;
  automations: AutomationStore;
  notifications: NotificationStore;
  serverTimestamp: unknown;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface TickSummary {
  windowStartMs: number;
  recurringRuns: number;
  dateRuns: number;
  /** Outcomes by status, scheduled runs only. */
  outcomes: Record<RunOutcome['status'], number>;
  /** True when something threw: `lastTickAt` was not advanced, so the next tick retries. */
  hadErrors: boolean;
}

// -- Local time ------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes since local midnight of the instant `ms` on the wall clock of `timezone`. */
export function localMinutesInZone(ms: number, timezone: string): number {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timezone, f);
  }
  let hour = 0;
  let minute = 0;
  for (const part of f.formatToParts(new Date(ms))) {
    if (part.type === 'hour') hour = Number(part.value);
    if (part.type === 'minute') minute = Number(part.value);
  }
  return hour * 60 + minute;
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** `true` when local moment (dateA, minA) is after (dateB, minB). `YYYY-MM-DD` sorts as text. */
const laterThan = (dateA: string, minA: number, dateB: string, minB: number): boolean =>
  dateA > dateB || (dateA === dateB && minA > minB);

/** The time a date cell carries (`HH:MM`), when it has one. */
function cellTime(values: Record<string, unknown>, columnId: string): string | null {
  const cell = values[columnId] as { time?: unknown } | null | undefined;
  const time = cell?.time;
  return typeof time === 'string' && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : null;
}

// -- Recurring -------------------------------------------------------------------------------

/**
 * The latest occurrence of the recipe that is at or before `nowMs`, starting from its stored
 * `nextRunAt`. A schedule that cannot be computed returns `nextRunAt` itself.
 */
export function latestOccurrence(automation: AutomationDoc, nowMs: number): number {
  const first = automation.nextRunAtMs ?? nowMs;
  if (automation.trigger.type !== 'recurring' || !automation.timezone) return first;
  let latest = first;
  try {
    // A daily recipe misses at most a few hundred occurrences even after a very long gap.
    for (let i = 0; i < 400; i += 1) {
      const next = computeNextRunAt(automation.trigger, automation.timezone, latest);
      if (next > nowMs) break;
      latest = next;
    }
  } catch {
    return first;
  }
  return latest;
}

async function runRecurring(deps: TickDeps, nowMs: number, summary: TickSummary): Promise<void> {
  for (const { boardId, automation } of await deps.store.listDueRecurring(nowMs)) {
    if (automation.nextRunAtMs == null) continue;
    try {
      const scheduledForMs = latestOccurrence(automation, nowMs);
      const iso = new Date(scheduledForMs).toISOString();
      const outcome = await runAutomation(
        deps.automations,
        {
          boardId,
          automationId: automation.id,
          eventId: iso,
          itemId: null,
          runId: recurringRunId(automation.id, iso),
          depth: 0,
          recurring: {
            scheduledForMs,
            expectedNextRunAtMs: automation.nextRunAtMs,
            stale: nowMs - scheduledForMs > CATCH_UP_CAP_MS,
          },
        },
        deps.serverTimestamp,
      );
      summary.outcomes[outcome.status] += 1;
      if (outcome.status !== 'none') summary.recurringRuns += 1;
      await deliverOutcome(deps, boardId, null, outcome);
    } catch (error) {
      summary.hadErrors = true;
      deps.log?.('Recurring automation failed', {
        boardId,
        automationId: automation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// -- Date arrives ----------------------------------------------------------------------------

async function runDateArrives(
  deps: TickDeps,
  nowMs: number,
  windowStartMs: number,
  summary: TickSummary,
): Promise<void> {
  for (const { boardId, automation } of await deps.store.listDateArrivesRecipes()) {
    const { trigger, timezone } = automation;
    // A recipe that no longer parses has no trigger to read; it is left to the person to fix.
    if (automation.invalid || trigger.type !== 'date_arrives' || !timezone) continue;
    try {
      const today = localDateInZone(nowMs, timezone);
      const nowMin = localMinutesInZone(nowMs, timezone);
      const startDate = localDateInZone(windowStartMs, timezone);
      const startMin = localMinutesInZone(windowStartMs, timezone);
      // Local days of the window, oldest first: at most 3 for a 24 hour window.
      for (let day = startDate, n = 0; day <= today && n < 4; day = addDaysToDate(day, 1), n += 1) {
        const target = dateArrivesTargetDate(day, trigger.offsetDays);
        const items = await deps.store.listItemsByDateKey(
          boardId,
          `${trigger.columnId}:${target}`,
          DATE_LOOKUP_LIMIT,
        );
        for (const item of items) {
          const at = minutesOf(
            trigger.at ?? cellTime(item.values, trigger.columnId) ?? DEFAULT_DATE_TIME,
          );
          // Fires once the local time of day has come, and only if that moment is inside the
          // window: a moment before `lastTickAt` was handled by an earlier tick (or missed
          // beyond the cap), one after `now` waits for a later tick.
          if (!laterThan(day, at, startDate, startMin)) continue;
          if (laterThan(day, at, today, nowMin)) continue;
          const outcome = await runAutomation(
            deps.automations,
            {
              boardId,
              automationId: automation.id,
              eventId: `date:${target}`,
              itemId: item.id,
              runId: dateRunId(automation.id, item.id, target),
              depth: 0,
              itemName: item.name,
            },
            deps.serverTimestamp,
          );
          summary.outcomes[outcome.status] += 1;
          if (outcome.status !== 'none') summary.dateRuns += 1;
          await deliverOutcome(deps, boardId, item.id, outcome);
          // The circuit breaker switched the recipe off: stop feeding it.
          if (outcome.status === 'failed' && outcome.disabled) break;
        }
      }
    } catch (error) {
      summary.hadErrors = true;
      deps.log?.('Date automation failed', {
        boardId,
        automationId: automation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Sends a committed run's notifications. A delivery error is logged; the run stays `delivered: false`. */
async function deliverOutcome(
  deps: TickDeps,
  boardId: string,
  itemId: string | null,
  outcome: RunOutcome,
): Promise<void> {
  if ((outcome.status !== 'ok' && outcome.status !== 'failed') || !outcome.delivery) return;
  await deliver(
    {
      store: deps.automations,
      notifications: deps.notifications,
      serverTimestamp: deps.serverTimestamp,
      ...(deps.log ? { log: deps.log } : {}),
    },
    boardId,
    {
      runId: outcome.runId,
      itemId,
      delivery: outcome.delivery,
      ...(outcome.status === 'failed' ? { error: outcome.error } : {}),
    },
  ).catch(() => undefined);
}

// -- The tick --------------------------------------------------------------------------------

/**
 * One scheduler tick at `nowMs`. `lastTickAt` moves to `nowMs` only when nothing threw, so a failed
 * tick is retried from the same window (the deterministic run ids make that safe).
 */
export async function runTick(deps: TickDeps, nowMs: number): Promise<TickSummary> {
  const last = await deps.store.getLastTickMs();
  const windowStartMs = Math.max(last ?? nowMs - TICK_INTERVAL_MS, nowMs - CATCH_UP_CAP_MS);
  const summary: TickSummary = {
    windowStartMs,
    recurringRuns: 0,
    dateRuns: 0,
    outcomes: { none: 0, ok: 0, skipped: 0, failed: 0 },
    hadErrors: false,
  };
  await runRecurring(deps, nowMs, summary);
  await runDateArrives(deps, nowMs, windowStartMs, summary);
  if (!summary.hadErrors) await deps.store.setLastTickMs(nowMs);
  return summary;
}
