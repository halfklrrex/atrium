import { AUTOMATION_LIMITS } from '@atrium/shared';

/**
 * Limits of the automation engine (P5a). The numbers live in `@atrium/shared` so the web shows the
 * same ones; this module adds the runner's own constants and the small pure helpers around them.
 */
export const MAX_AUTOMATIONS_CONSIDERED = AUTOMATION_LIMITS.maxPerBoard;
export const MAX_RUNS_PER_HOUR = AUTOMATION_LIMITS.maxRunsPerHour;
export const MAX_DEPTH = AUTOMATION_LIMITS.maxDepth;
/** Consecutive failed runs after which an automation is switched off. */
export const CIRCUIT_BREAKER_FAILURES = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_BUCKET_LENGTH = 13; // 'YYYY-MM-DDTHH'

/** The ISO hour of `nowMs`, e.g. `2026-11-04T09`: the key of the hourly counter. */
export const hourBucketOf = (nowMs: number): string =>
  new Date(nowMs).toISOString().slice(0, HOUR_BUCKET_LENGTH);

/** `${automationId}-${eventId}`: the run document id and the item's `automationRunId`. */
export const runIdOf = (automationId: string, eventId: string): string =>
  `${automationId}-${eventId}`;

/** Epoch milliseconds when a run started at `startMs` is deleted by the TTL policy. */
export const runExpiresAtMs = (startMs: number): number =>
  startMs + AUTOMATION_LIMITS.runTtlDays * DAY_MS;

export interface RunCounter {
  hourBucket: string;
  runs: number;
}

/** The counter as it stands in the hour of `nowMs`: a new hour starts again at zero. */
export function counterForNow(counter: RunCounter | null, nowMs: number): RunCounter {
  const hourBucket = hourBucketOf(nowMs);
  return counter && counter.hourBucket === hourBucket ? counter : { hourBucket, runs: 0 };
}

/** True when one more run in this hour would pass the limit. */
export const rateLimited = (counter: RunCounter): boolean => counter.runs >= MAX_RUNS_PER_HOUR;

/** The actor id an automation's writes carry (`updatedVia` and the activity actor). */
export const automationActorId = (automationId: string): string => `automation:${automationId}`;
