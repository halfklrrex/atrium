import { z } from 'zod';
import { defineColumnType } from './registry';
import { timestampToIso } from './timestamp';

export const lastUpdatedSettingsSchema = z
  .object({
    mode: z.enum(['personOnly', 'dateOnly', 'personAndDate']).default('personAndDate'),
  })
  .strict();
export type LastUpdatedSettings = z.infer<typeof lastUpdatedSettingsSchema>;

/**
 * monday last_updated column value: `{"updated_at": "2026-10-24T12:00:00.000Z", "updater_id": "u123"}`.
 * Derived from item updatedAt and updatedBy metadata.
 * // TODO(derived): purely derived from item metadata.
 */
export const lastUpdatedValueSchema = z
  .object({
    updated_at: z.iso.datetime('Expected a valid ISO datetime string'),
    updater_id: z.string().min(1).max(128).optional(),
  })
  .strict();
export type LastUpdatedValue = z.infer<typeof lastUpdatedValueSchema>;

/**
 * Compute last updated value from item metadata.
 */
export function computeLastUpdated(item: {
  updatedAt?: unknown;
  updatedBy?: string | null;
}): LastUpdatedValue | null {
  const iso = timestampToIso(item.updatedAt);
  if (!iso) return null;
  return {
    updated_at: iso,
    updater_id: item.updatedBy ?? undefined,
  };
}

export const lastUpdatedColumn = defineColumnType<LastUpdatedSettings, LastUpdatedValue>({
  type: 'last_updated',
  label: 'Last Updated',
  derived: true,
  settingsSchema: lastUpdatedSettingsSchema,
  valueSchema: lastUpdatedValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled', 'earliest', 'latest'],
  defaultSettings: () => ({ mode: 'personAndDate' }),
  toText: (value, settings) => {
    const mode = settings?.mode ?? 'personAndDate';
    if (mode === 'dateOnly') return value.updated_at;
    if (mode === 'personOnly') return value.updater_id ?? '';
    return value.updater_id ? `${value.updated_at} by ${value.updater_id}` : value.updated_at;
  },
  compare: (a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
  compute: (ctx) => computeLastUpdated(ctx.item),
});
