import { z } from 'zod';
import { defineColumnType } from './registry';

export const autoNumberSettingsSchema = z
  .object({
    scope: z.enum(['board', 'group']).default('board'),
    prefix: z.string().max(20).optional(),
    order: z.enum(['ascending', 'descending']).default('ascending'),
  })
  .strict();
export type AutoNumberSettings = z.infer<typeof autoNumberSettingsSchema>;

/**
 * monday auto_number column value: `{"auto_number": 1}`. Derived: computed from the item's
 * server-assigned `boardSeq` (per-board creation number, set by the `onItemCreated` Function);
 * nothing is stored in `values`.
 */
export const autoNumberValueSchema = z
  .object({
    auto_number: z.number().int().min(0),
  })
  .strict();
export type AutoNumberValue = z.infer<typeof autoNumberValueSchema>;

export const autoNumberColumn = defineColumnType<AutoNumberSettings, AutoNumberValue>({
  type: 'auto_number',
  label: 'Auto Number',
  derived: true,
  settingsSchema: autoNumberSettingsSchema,
  valueSchema: autoNumberValueSchema,
  summaries: [
    'count',
    'count_filled',
    'count_empty',
    'percent_filled',
    'min',
    'max',
    'average',
    'sum',
  ],
  defaultSettings: () => ({ scope: 'board', order: 'ascending' }),
  toText: (value, settings) => {
    const num = value.auto_number;
    return settings?.prefix ? `${settings.prefix}${num}` : String(num);
  },
  compare: (a, b) => a.auto_number - b.auto_number,
  compute: (ctx) =>
    typeof ctx.item.boardSeq === 'number' ? { auto_number: ctx.item.boardSeq } : null,
});
