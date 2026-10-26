import { z } from 'zod';
import { CANONICAL_TIMEZONES } from './canonical-timezones';
import { defineColumnType } from './registry';

export { CANONICAL_TIMEZONES } from './canonical-timezones';

export const worldClockSettingsSchema = z
  .object({
    /** Whether to display time in 24-hour format vs 12-hour AM/PM format. */
    format24Hour: z.boolean().default(true),
    /** Whether to display the city / location name alongside the time. */
    showCity: z.boolean().default(true),
  })
  .strict();
export type WorldClockSettings = z.infer<typeof worldClockSettingsSchema>;

/**
 * Validates that tz is a canonical, case-exact IANA timezone name (not an alias).
 * Validated against the bundled static list of canonical IANA zones (zone1970.tab + UTC)
 * for cross-platform ICU independence.
 */
export function isValidTimezone(tz: string): boolean {
  return CANONICAL_TIMEZONES.has(tz);
}

/**
 * monday world_clock column value shape: `{"timezone": "Europe/London"}`
 */
export const worldClockValueSchema = z
  .object({
    /** Valid canonical IANA timezone name, e.g. "Europe/London", "America/New_York", "UTC". */
    timezone: z.string().min(1).refine(isValidTimezone, {
      message: 'Expected a valid canonical IANA timezone (e.g. "Europe/London", "UTC")',
    }),
  })
  .strict();
export type WorldClockValue = z.infer<typeof worldClockValueSchema>;

/**
 * Extracts a friendly city name from an IANA timezone identifier.
 * e.g. "America/New_York" -> "New York", "Europe/London" -> "London", "UTC" -> "UTC".
 */
export function getDefaultCity(timezone: string): string {
  const parts = timezone.split('/');
  const last = parts.at(-1) ?? timezone;
  return last.replace(/_/g, ' ');
}

/**
 * Formats the current time in the specified timezone according to settings.
 */
export function formatWorldClockTime(
  timezone: string,
  date: Date = new Date(),
  format24Hour = true,
): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: !format24Hour,
  });
  return formatter.format(date);
}

/**
 * Computes the UTC offset in minutes for a given timezone at a specific date.
 * Uses formatToParts and Date.UTC to remain exact and immune to local system timezone or DST gaps.
 * Positive for timezones ahead of UTC (e.g. +60 for CET), negative for timezones behind UTC (e.g. -300 for EST).
 */
export function getTimezoneOffsetMinutes(timezone: string, date: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) {
    p[type] = value;
  }
  const year = parseInt(p.year ?? '0', 10);
  const month = parseInt(p.month ?? '1', 10) - 1;
  const day = parseInt(p.day ?? '1', 10);
  let hour = parseInt(p.hour ?? '0', 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(p.minute ?? '0', 10);
  const second = parseInt(p.second ?? '0', 10);
  const tzUtcMs = Date.UTC(year, month, day, hour, minute, second);
  const utcMs = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((tzUtcMs - utcMs) / 60000);
}

export const worldClockColumn = defineColumnType<WorldClockSettings, WorldClockValue>({
  type: 'world_clock',
  label: 'World Clock',
  settingsSchema: worldClockSettingsSchema,
  valueSchema: worldClockValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({ format24Hour: true, showCity: true }),
  toText: (value, settings) => {
    const city = settings.showCity ? getDefaultCity(value.timezone) : '';
    return city ? `${value.timezone} (${city})` : value.timezone;
  },
  compare: (a, b) => {
    const offsetDiff = getTimezoneOffsetMinutes(a.timezone) - getTimezoneOffsetMinutes(b.timezone);
    return offsetDiff !== 0 ? offsetDiff : a.timezone.localeCompare(b.timezone);
  },
});
