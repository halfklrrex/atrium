import { z } from 'zod';
import { isoDateSchema } from './date';
import { defineColumnType } from './registry';

export const weekSettingsSchema = z
  .object({
    /** Start day of the week ('monday' for ISO 8601 standard, 'sunday' for US standard). */
    firstDayOfWeek: z.enum(['monday', 'sunday']).default('monday'),
  })
  .strict();
export type WeekSettings = z.infer<typeof weekSettingsSchema>;

export const weekRangeSchema = z
  .object({
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .strict();
export type WeekRange = z.infer<typeof weekRangeSchema>;

/**
 * monday week column value shape: `{"week": {"startDate": "2026-10-19", "endDate": "2026-10-25"}}`
 */
export const weekValueSchema = z
  .object({
    week: weekRangeSchema,
  })
  .strict()
  .refine((val) => val.week.startDate <= val.week.endDate, {
    message: 'startDate must be before or equal to endDate',
    path: ['week', 'endDate'],
  });
export type WeekValue = z.infer<typeof weekValueSchema>;

/**
 * Calculates the ISO 8601 week number and week-year for a given YYYY-MM-DD date.
 */
export function getIsoWeek(dateStr: string): { weekNumber: number; year: number } {
  const d = new Date(dateStr + 'T00:00:00Z');
  // ISO week date days start with Monday=1 and end with Sunday=7
  const day = d.getUTCDay() || 7;
  // Thursday in current week decides the year
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const weekNumber = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { weekNumber, year };
}

/**
 * Returns the calendar start and end dates (YYYY-MM-DD) for the 7-day week containing the date.
 */
export function getWeekDateRange(
  dateStr: string,
  firstDayOfWeek: 'monday' | 'sunday' = 'monday',
): { startDate: string; endDate: string } {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay(); // 0 is Sunday, 1 is Monday
  const diffToStart = firstDayOfWeek === 'monday' ? (day === 0 ? -6 : 1 - day) : -day;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() + diffToStart);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/**
 * Validates that a WeekValue represents a valid 7-day week span starting on settings.firstDayOfWeek.
 */
export function validateWeekValue(value: WeekValue, settings: WeekSettings): boolean {
  const dStart = new Date(value.week.startDate + 'T00:00:00Z');
  if (Number.isNaN(dStart.getTime())) return false;
  const startDay = dStart.getUTCDay(); // 0 is Sunday, 1 is Monday

  if (settings.firstDayOfWeek === 'monday' && startDay !== 1) return false;
  if (settings.firstDayOfWeek === 'sunday' && startDay !== 0) return false;

  const dEnd = new Date(value.week.endDate + 'T00:00:00Z');
  if (Number.isNaN(dEnd.getTime())) return false;
  const diffDays = Math.round((dEnd.getTime() - dStart.getTime()) / 86400000);
  return diffDays === 6;
}

/**
 * Formats a WeekValue into a human-readable string: e.g. "W43 (2026-10-19 - 2026-10-25)".
 * Uses Thursday of the 7-day span to ensure the ISO week reflects the majority of the days,
 * even for Sunday-first weeks.
 */
export function formatWeek(value: WeekValue): string {
  const d = new Date(value.week.startDate + 'T00:00:00Z');
  const day = d.getUTCDay();
  // Find Thursday in this 7-day span (always present, represents the majority of days)
  const daysToThursday = (4 - day + 7) % 7;
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + daysToThursday);
  const thursdayDateStr = thursday.toISOString().slice(0, 10);
  const { weekNumber } = getIsoWeek(thursdayDateStr);
  return `W${weekNumber} (${value.week.startDate} - ${value.week.endDate})`;
}

export const weekColumn = defineColumnType<WeekSettings, WeekValue>({
  type: 'week',
  label: 'Week',
  settingsSchema: weekSettingsSchema,
  valueSchema: weekValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled', 'earliest', 'latest'],
  defaultSettings: () => ({ firstDayOfWeek: 'monday' }),
  toText: (value) => formatWeek(value),
  compare: (a, b) =>
    a.week.startDate.localeCompare(b.week.startDate) ||
    a.week.endDate.localeCompare(b.week.endDate),
  aggregate: (values) => {
    let earliest: string | null = null;
    let latest: string | null = null;
    for (const v of values) {
      if (!v) continue;
      if (!earliest || v.week.startDate < earliest) earliest = v.week.startDate;
      if (!latest || v.week.endDate > latest) latest = v.week.endDate;
    }
    return earliest && latest ? { kind: 'range', earliest, latest } : null;
  },
});
