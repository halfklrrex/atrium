import { z } from 'zod';
import { defineColumnType } from './registry';

export const longTextSettingsSchema = z.object({}).strict();
export type LongTextSettings = z.infer<typeof longTextSettingsSchema>;

/** monday long text value: `{"text":"...","changed_at":"2019-06-03T13:25:00.000Z"}`. */
export const longTextValueSchema = z.object({
  text: z.string().max(100_000),
  changed_at: z.string().max(40).optional(),
});
export type LongTextValue = z.infer<typeof longTextValueSchema>;

export const longTextColumn = defineColumnType<LongTextSettings, LongTextValue>({
  type: 'long_text',
  label: 'Long text',
  settingsSchema: longTextSettingsSchema,
  valueSchema: longTextValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({}),
  toText: (value) => value.text,
  compare: (a, b) =>
    a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' }),
});
