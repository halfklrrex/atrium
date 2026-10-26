import { z } from 'zod';
import { defineColumnType } from './registry';

export const countrySettingsSchema = z.object({}).strict();
export type CountrySettings = z.infer<typeof countrySettingsSchema>;

/**
 * monday country column value: `{"countryCode": "US", "countryName": "United States"}`.
 */
export const countryValueSchema = z
  .object({
    countryCode: z.string().length(2).toUpperCase(),
    countryName: z.string().min(1).max(100).optional(),
  })
  .strict();
export type CountryValue = z.infer<typeof countryValueSchema>;

export const countryColumn = defineColumnType<CountrySettings, CountryValue>({
  type: 'country',
  label: 'Country',
  settingsSchema: countrySettingsSchema,
  valueSchema: countryValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({}),
  toText: (value) => value.countryName || value.countryCode,
  compare: (a, b) => {
    const textA = a.countryName || a.countryCode;
    const textB = b.countryName || b.countryCode;
    return textA.localeCompare(textB, undefined, { sensitivity: 'base' });
  },
});
