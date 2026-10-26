import { z } from 'zod';
import { isoDateSchema } from './date';
import { defineColumnType } from './registry';

export const timelineSettingsSchema = z
  .object({
    /** Whether to show a progress percentage in the cell / summary. */
    showProgress: z.boolean().default(false),
  })
  .strict();
export type TimelineSettings = z.infer<typeof timelineSettingsSchema>;

export const timelineValueSchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .strict()
  .refine((val) => val.from <= val.to, {
    message: 'The "from" date must be before or equal to the "to" date',
    path: ['to'],
  });
export type TimelineValue = z.infer<typeof timelineValueSchema>;

/**
 * Calculates the inclusive span of a timeline in calendar days.
 * e.g. 2026-10-24 to 2026-10-24 is 1 day.
 */
export function getTimelineDurationDays(value: TimelineValue): number {
  const fromMs = new Date(value.from + 'T00:00:00Z').getTime();
  const toMs = new Date(value.to + 'T00:00:00Z').getTime();
  return Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Computes the percentage completion of a timeline relative to a given date (defaults to today UTC).
 * Returns an integer between 0 and 100 inclusive.
 */
export function computeTimelineProgress(value: TimelineValue, nowIsoDate?: string): number {
  const today = nowIsoDate ?? new Date().toISOString().slice(0, 10);
  if (today <= value.from) return 0;
  if (today >= value.to) return 100;
  const fromMs = new Date(value.from + 'T00:00:00Z').getTime();
  const toMs = new Date(value.to + 'T00:00:00Z').getTime();
  const nowMs = new Date(today + 'T00:00:00Z').getTime();
  const total = toMs - fromMs;
  if (total <= 0) return 100;
  const elapsed = nowMs - fromMs;
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

export const timelineColumn = defineColumnType<TimelineSettings, TimelineValue>({
  type: 'timeline',
  label: 'Timeline',
  settingsSchema: timelineSettingsSchema,
  valueSchema: timelineValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled', 'earliest', 'latest'],
  defaultSettings: () => ({ showProgress: false }),
  toText: (value) => `${value.from} - ${value.to}`,
  compare: (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  aggregate: (values) => {
    let earliest: string | null = null;
    let latest: string | null = null;
    for (const v of values) {
      if (!v) continue;
      if (!earliest || v.from < earliest) earliest = v.from;
      if (!latest || v.to > latest) latest = v.to;
    }
    return earliest && latest ? { kind: 'range', earliest, latest } : null;
  },
});
