import { z } from 'zod';
import { defineColumnType } from './registry';

export const textSettingsSchema = z.object({}).strict();
export type TextSettings = z.infer<typeof textSettingsSchema>;

/** monday's text column value is a plain string. */
export const textValueSchema = z.string().max(100_000);
export type TextValue = z.infer<typeof textValueSchema>;

export const textColumn = defineColumnType<TextSettings, TextValue>({
  type: 'text',
  label: 'Text',
  settingsSchema: textSettingsSchema,
  valueSchema: textValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({}),
  toText: (value) => value,
  compare: (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
});
