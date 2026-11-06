import { dateValueSchema } from './columns/date';
import type { AutomationTrigger } from './schemas/automation';

/**
 * Pure helpers of the time-based automations (P5d): next-run computation (daylight-saving aware,
 * via `Intl.DateTimeFormat`, no dependency), the `dateKeys` item index and deterministic run ids.
 */

const DAY_MS = 86_400_000;

type RecurringTrigger = Extract<AutomationTrigger, { type: 'recurring' }>;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, f);
  }
  return f;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(ms: number, timezone: string): LocalParts {
  const out: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out as unknown as LocalParts;
}

/** Offset of the zone from UTC at `ms`, in milliseconds (local wall clock minus UTC). */
function offsetAt(ms: number, timezone: string): number {
  const p = localParts(ms, timezone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** `YYYY-MM-DD` of the instant `ms` on the wall clock of `timezone`. */
export function localDateInZone(ms: number, timezone: string): string {
  const p = localParts(ms, timezone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Adds `days` (may be negative) to a `YYYY-MM-DD` calendar date. */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * The date an item's date cell must hold today (`todayInZone`, `YYYY-MM-DD`) for a `date_arrives`
 * trigger with `offsetDays` (days after the date; -3 means 3 days before, so the target is today + 3).
 */
export function dateArrivesTargetDate(todayInZone: string, offsetDays: number): string {
  return addDaysToDate(todayInZone, -offsetDays);
}

/**
 * UTC ms of the wall-clock time `date` `hour:minute` in `timezone`. A time that does not exist
 * (spring forward) resolves to the first valid instant after the gap; an ambiguous one (fall back)
 * to its first occurrence.
 */
function wallClockToUtc(date: string, hour: number, minute: number, timezone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const before = offsetAt(guess - DAY_MS, timezone);
  const after = offsetAt(guess + DAY_MS, timezone);
  const valid: number[] = [];
  for (const offset of new Set([before, after])) {
    const t = guess - offset;
    if (offsetAt(t, timezone) === offset) valid.push(t);
  }
  if (valid.length > 0) return Math.min(...valid);
  // In a gap (only possible when the offset grew): find the transition instant by bisection.
  let lo = guess - after; // still on the old offset
  let hi = guess - before; // already on the new offset
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (offsetAt(mid, timezone) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * UTC milliseconds of the next occurrence of a `recurring` trigger strictly after `afterMs`, on the
 * wall clock of `timezone` (IANA). Month recurrences use `dayOfMonth` (1..28, so every month has it).
 */
export function computeNextRunAt(
  trigger: Pick<RecurringTrigger, 'every' | 'weekday' | 'dayOfMonth' | 'at'>,
  timezone: string,
  afterMs: number,
): number {
  const [hour, minute] = trigger.at.split(':').map(Number) as [number, number];
  const startDate = addDaysToDate(localDateInZone(afterMs, timezone), -1);
  for (let i = 0; i < 70; i += 1) {
    const date = addDaysToDate(startDate, i);
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    if (
      trigger.every === 'week' &&
      new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== trigger.weekday
    ) {
      continue;
    }
    if (trigger.every === 'month' && d !== trigger.dayOfMonth) continue;
    const t = wallClockToUtc(date, hour, minute, timezone);
    if (t > afterMs) return t;
  }
  throw new Error('computeNextRunAt: the trigger never fires (missing weekday or dayOfMonth?)');
}

/**
 * Sorted unique `"<columnId>:<YYYY-MM-DD>"` for every `date` column cell holding a date (date
 * columns only; timeline ranges are not indexed). Used by the `dateKeys` item index.
 */
export function dateKeysOf(
  values: Record<string, unknown> | null | undefined,
  columns: ReadonlyArray<{ id: string; type: string }>,
): string[] {
  const found = new Set<string>();
  for (const column of columns) {
    if (column.type !== 'date') continue;
    const parsed = dateValueSchema.safeParse(values?.[column.id]);
    if (parsed.success) found.add(`${column.id}:${parsed.data.date}`);
  }
  return [...found].sort();
}

/** Deterministic run id of a recurring run: one run per recipe and scheduled instant. */
export function recurringRunId(automationId: string, scheduledForISO: string): string {
  return `recurring:${automationId}:${scheduledForISO}`;
}

/** Deterministic run id of a date run: a date fires once per recipe and item, however often it is edited. */
export function dateRunId(automationId: string, itemId: string, yyyyMmDd: string): string {
  return `date:${automationId}:${itemId}:${yyyyMmDd}`;
}
