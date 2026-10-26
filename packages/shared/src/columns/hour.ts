import { z } from 'zod';
import { defineColumnType } from './registry';

export const hourSettingsSchema = z
  .object({
    /** Whether to display time in 24-hour format (e.g. 14:30) vs 12-hour AM/PM format (e.g. 02:30 PM). */
    format24Hour: z.boolean().default(true),
  })
  .strict();
export type HourSettings = z.infer<typeof hourSettingsSchema>;

export const hourValueSchema = z
  .object({
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  })
  .strict();
export type HourValue = z.infer<typeof hourValueSchema>;

/**
 * Formats an HourValue as either 24-hour ("14:30") or 12-hour ("02:30 PM").
 */
export function formatHour(value: HourValue, format24Hour = true): string {
  const mm = String(value.minute).padStart(2, '0');
  if (format24Hour) {
    const hh = String(value.hour).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const period = value.hour >= 12 ? 'PM' : 'AM';
  const h12 = value.hour % 12 || 12;
  const hh = String(h12).padStart(2, '0');
  return `${hh}:${mm} ${period}`;
}

/**
 * Parses user input like "14:30", "2:30 PM", "2:30pm", "9:05" into an HourValue.
 */
export function parseHour(input: string): HourValue | null {
  const trimmed = input.trim();
  const match12 = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(trimmed);
  if (match12) {
    const [, hStr, mStr, pStr] = match12;
    if (hStr && mStr && pStr) {
      const rawH = parseInt(hStr, 10);
      const m = parseInt(mStr, 10);
      const p = pStr.toUpperCase();
      if (rawH < 1 || rawH > 12 || m < 0 || m > 59) return null;
      const h = p === 'PM' ? (rawH % 12) + 12 : rawH % 12;
      return { hour: h, minute: m };
    }
  }

  const match24 = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (match24) {
    const [, hStr, mStr] = match24;
    if (hStr && mStr) {
      const h = parseInt(hStr, 10);
      const m = parseInt(mStr, 10);
      if (h < 0 || h > 23 || m < 0 || m > 59) return null;
      return { hour: h, minute: m };
    }
  }

  return null;
}

export const hourColumn = defineColumnType<HourSettings, HourValue>({
  type: 'hour',
  label: 'Hour',
  settingsSchema: hourSettingsSchema,
  valueSchema: hourValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({ format24Hour: true }),
  toText: (value, settings) => formatHour(value, settings.format24Hour),
  compare: (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute),
});
