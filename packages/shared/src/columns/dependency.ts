import { z } from 'zod';
import { defineColumnType } from './registry';

export const dependencySettingsSchema = z
  .object({
    timeColumnId: z.string().min(1).max(64).optional(),
    strict: z.boolean().default(false),
  })
  .strict();
export type DependencySettings = z.infer<typeof dependencySettingsSchema>;

export const dependencyValueSchema = z
  .object({
    item_ids: z
      .array(z.string().min(1).max(128))
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'item_ids must be unique',
      }),
  })
  .strict();
export type DependencyValue = z.infer<typeof dependencyValueSchema>;

export const dependencyColumn = defineColumnType<DependencySettings, DependencyValue>({
  type: 'dependency',
  label: 'Dependency',
  settingsSchema: dependencySettingsSchema,
  valueSchema: dependencyValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({ strict: false }),
  toText: (value) => value.item_ids.join(', '),
  compare: (a, b) => {
    const diff = a.item_ids.length - b.item_ids.length;
    if (diff !== 0) return diff;
    return a.item_ids.join(',').localeCompare(b.item_ids.join(','));
  },
});
