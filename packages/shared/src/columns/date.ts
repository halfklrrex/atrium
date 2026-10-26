import { z } from 'zod';
import { defineColumnType } from './registry';

export const dateSettingsSchema = z
  .object({
    /** Hide the weekday in the cell (monday: "Hide week days"). */
    hideWeekdays: z.boolean().default(false),
  })
  .strict();
export type DateSettings = z.infer<typeof dateSettingsSchema>;

const isRealDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
  );
};

/** `YYYY-MM-DD`, validated as a real calendar date. */
export const isoDateSchema = z.string().refine(isRealDate, 'Expected a YYYY-MM-DD date');
/** `HH:MM:SS` (24h). */
export const isoTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, 'Expected HH:MM:SS');

/** monday date value: `{"date":"2019-06-03","time":"13:25:00"}`; `time` is optional. */
export const dateValueSchema = z.object({
  date: isoDateSchema,
  time: isoTimeSchema.nullish(),
});
export type DateValue = z.infer<typeof dateValueSchema>;

const sortKey = (v: DateValue): string => `${v.date}T${v.time ?? '00:00:00'}`;

export const dateColumn = defineColumnType<DateSettings, DateValue>({
  type: 'date',
  label: 'Date',
  settingsSchema: dateSettingsSchema,
  valueSchema: dateValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled', 'earliest', 'latest'],
  defaultSettings: () => ({ hideWeekdays: false }),
  aggregate: (values) => {
    const dates = values.flatMap((v) => (v ? [v.date] : [])).sort();
    const earliest = dates[0];
    const latest = dates.at(-1);
    return earliest && latest ? { kind: 'range', earliest, latest } : null;
  },
  // monday's API `text` for a date column: "2019-06-03" or "2019-06-03 13:25:00".
  toText: (value) => (value.time ? `${value.date} ${value.time}` : value.date),
  compare: (a, b) => sortKey(a).localeCompare(sortKey(b)),
});
