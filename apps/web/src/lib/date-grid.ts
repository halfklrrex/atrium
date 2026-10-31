/**
 * Date maths for the Calendar (and later Timeline) views. Everything works on `YYYY-MM-DD` strings
 * and UTC `Date`s, so a day is a day whatever the time zone or daylight saving. No date library.
 */
import { getWeekDateRange } from '@atrium/shared';

export type FirstDayOfWeek = 'monday' | 'sunday';

const DAY_MS = 86_400_000;
const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** An ISO day as a UTC `Date` at midnight. */
export function parseIsoDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** A UTC `Date` as `YYYY-MM-DD`. */
export function formatIsoDay(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Today in the user's own time zone as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  return formatIsoDay(new Date(parseIsoDay(iso).getTime() + days * DAY_MS));
}

export const addWeeks = (iso: string, weeks: number): string => addDays(iso, weeks * 7);

/** Days in a month (`month` is 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Months later (or earlier); the day of the month is kept, or clamped to the month's last day. */
export function addMonths(iso: string, months: number): string {
  const d = parseIsoDay(iso);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  target.setUTCDate(Math.min(day, last));
  return formatIsoDay(target);
}

/** `b - a` in whole days. */
export function diffDays(a: string, b: string): number {
  return Math.round((parseIsoDay(b).getTime() - parseIsoDay(a).getTime()) / DAY_MS);
}

/** Days from `from` to `to`, both included (0 when `to` is before `from`). */
export function inclusiveSpan(from: string, to: string): number {
  return Math.max(0, diffDays(from, to) + 1);
}

/** The position of a day on an axis that starts at `axisStart` (0 = the first day). */
export const dayIndex = (iso: string, axisStart: string): number => diffDays(axisStart, iso);

/** 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (iso: string): number => parseIsoDay(iso).getUTCDay();

export const isWeekend = (iso: string): boolean => {
  const day = weekdayOf(iso);
  return day === 0 || day === 6;
};

/** The first day of the week containing `iso` (the week column's helper, reused). */
export function weekStart(iso: string, firstDayOfWeek: FirstDayOfWeek): string {
  return getWeekDateRange(iso, firstDayOfWeek).startDate;
}

/** The seven days of the week containing `iso`, without Saturday and Sunday when asked. */
export function weekDays(
  iso: string,
  firstDayOfWeek: FirstDayOfWeek,
  showWeekends = true,
): string[] {
  const start = weekStart(iso, firstDayOfWeek);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return showWeekends ? days : days.filter((d) => !isWeekend(d));
}

/**
 * The weeks a month grid shows: every week that touches the month, each as its days (days of the
 * neighbouring months included). 4 to 6 rows.
 */
export function monthGrid(
  iso: string,
  firstDayOfWeek: FirstDayOfWeek,
  showWeekends = true,
): string[][] {
  const d = parseIsoDay(iso);
  const first = formatIsoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
  const last = addDays(first, daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1) - 1);
  const weeks: string[][] = [];
  for (let start = weekStart(first, firstDayOfWeek); start <= last; start = addDays(start, 7)) {
    weeks.push(weekDays(start, firstDayOfWeek, showWeekends));
  }
  return weeks;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** "October 2026". */
export function monthTitle(iso: string): string {
  const d = parseIsoDay(iso);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Oct 19 - 25, 2026", "Oct 26 - Nov 1, 2026" or, across years, "Dec 28, 2026 - Jan 3, 2027". */
export function rangeTitle(from: string, to: string): string {
  const a = parseIsoDay(from);
  const b = parseIsoDay(to);
  const month = (d: Date) => SHORT_MONTHS[d.getUTCMonth()];
  if (a.getUTCFullYear() !== b.getUTCFullYear()) {
    return `${month(a)} ${a.getUTCDate()}, ${a.getUTCFullYear()} – ${month(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  }
  const end =
    a.getUTCMonth() === b.getUTCMonth() ? `${b.getUTCDate()}` : `${month(b)} ${b.getUTCDate()}`;
  return `${month(a)} ${a.getUTCDate()} – ${end}, ${b.getUTCFullYear()}`;
}

/** "Monday, October 26, 2026" (an accessible name for a day cell). */
export function fullDateLabel(iso: string): string {
  const d = parseIsoDay(iso);
  return `${WEEKDAY_NAMES[d.getUTCDay()]}, ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Oct 3" (used in "Name, Oct 3 to Oct 17"). */
export function shortDateLabel(iso: string): string {
  const d = parseIsoDay(iso);
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
