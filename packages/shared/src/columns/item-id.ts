import { z } from 'zod';
import { defineColumnType } from './registry';

export const customKeySettingsSchema = z
  .object({
    prefix: z.string().max(20).default(''),
  })
  .strict();

export const itemIdSettingsSchema = z
  .object({
    displayType: z.enum(['id', 'customKey']).default('id'),
    customKeySettings: customKeySettingsSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.displayType === 'customKey' && !data.customKeySettings) {
      ctx.addIssue({
        code: 'custom',
        path: ['customKeySettings'],
        message: 'customKeySettings is required when displayType is customKey',
      });
    }
  });
export type ItemIdSettings = z.infer<typeof itemIdSettingsSchema>;

/**
 * Item ID is derived from the server-assigned `seq` of the item (account-wide number, handed out by
 * the `onItemCreated` Function): nothing is stored in `values`. The computed value is the bare
 * number as a string; the custom key prefix is applied at display time by `formatItemId` (`toText`
 * and the cell), so sorting stays numeric.
 */
export const itemIdValueSchema = z.string();
export type ItemIdValue = string;

/**
 * Format an item ID based on settings.
 */
export function formatItemId(id: string, settings?: ItemIdSettings): string {
  if (settings?.displayType === 'customKey' && settings.customKeySettings) {
    const prefix = settings.customKeySettings.prefix ?? '';
    return `${prefix}${id}`;
  }
  return id;
}

/**
 * Compute the item ID value of an item: its `seq` as a string, or `null` until the server has
 * assigned one. The settings are unused here (the prefix is a display concern); kept for symmetry.
 */
export function computeItemId(item: { seq?: number }, _settings?: ItemIdSettings): string | null {
  return typeof item.seq === 'number' ? String(item.seq) : null;
}

export const itemIdColumn = defineColumnType<ItemIdSettings, ItemIdValue>({
  type: 'item_id',
  label: 'Item ID',
  derived: true,
  settingsSchema: itemIdSettingsSchema,
  valueSchema: itemIdValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({ displayType: 'id' }),
  toText: (value, settings) => formatItemId(value, settings),
  compare: (a, b) => {
    const isNumA = /^\d+$/.test(a);
    const isNumB = /^\d+$/.test(b);
    if (isNumA && isNumB) {
      return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
    }
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  },
  compute: (ctx, settings) => computeItemId(ctx.item, settings),
});
