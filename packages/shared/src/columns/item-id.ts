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
 * Item ID is derived purely from item.id (no user-writable stored value).
 * // TODO(derived): purely derived from item.id.
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
 * Compute formatted item ID from item and column settings.
 */
export function computeItemId(item: { id: string }, settings?: ItemIdSettings): string {
  return formatItemId(item.id, settings);
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
