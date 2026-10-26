import { z } from 'zod';
import { defineColumnType } from './registry';
import { timestampToIso } from './timestamp';

export const creationLogSettingsSchema = z
  .object({
    mode: z.enum(['personOnly', 'dateOnly', 'personAndDate']).default('personAndDate'),
  })
  .strict();
export type CreationLogSettings = z.infer<typeof creationLogSettingsSchema>;

/**
 * monday creation_log column value: `{"created_at": "2026-10-24T12:00:00.000Z", "creator_id": "u123"}`.
 * Derived from item createdAt and createdBy metadata.
 * // TODO(derived): purely derived from item metadata.
 */
export const creationLogValueSchema = z
  .object({
    created_at: z.iso.datetime('Expected a valid ISO datetime string'),
    creator_id: z.string().min(1).max(128).optional(),
  })
  .strict();
export type CreationLogValue = z.infer<typeof creationLogValueSchema>;

/**
 * Compute creation log value from item metadata.
 */
export function computeCreationLog(item: {
  createdAt?: unknown;
  createdBy?: string | null;
}): CreationLogValue | null {
  const iso = timestampToIso(item.createdAt);
  if (!iso) return null;
  return {
    created_at: iso,
    creator_id: item.createdBy ?? undefined,
  };
}

export const creationLogColumn = defineColumnType<CreationLogSettings, CreationLogValue>({
  type: 'creation_log',
  label: 'Creation Log',
  derived: true,
  settingsSchema: creationLogSettingsSchema,
  valueSchema: creationLogValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled', 'earliest', 'latest'],
  defaultSettings: () => ({ mode: 'personAndDate' }),
  toText: (value, settings) => {
    const mode = settings?.mode ?? 'personAndDate';
    if (mode === 'dateOnly') return value.created_at;
    if (mode === 'personOnly') return value.creator_id ?? '';
    return value.creator_id ? `${value.created_at} by ${value.creator_id}` : value.created_at;
  },
  compare: (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  compute: (ctx) => computeCreationLog(ctx.item),
});
