import { z } from 'zod';
import { defineColumnType } from './registry';
import {
  findStatusLabel,
  statusSettingsSchema,
  statusValueSchema,
  type StatusLabel,
} from './status';

export const progressRelatedColumnSchema = z
  .object({
    isSelected: z.boolean(),
    percentage: z.number().min(0).max(100),
  })
  .strict();

export const progressSettingsSchema = z
  .object({
    related_columns: z
      .object({
        isNormalized: z.boolean(),
        columns: z.record(z.string(), progressRelatedColumnSchema),
      })
      .strict(),
  })
  .strict();
export type ProgressSettings = z.infer<typeof progressSettingsSchema>;

/**
 * monday progress column value: `{"progress": 75}` (integer 0..100).
 * // TODO(derived): purely derived from referenced status columns.
 */
export const progressValueSchema = z
  .object({
    progress: z.number().int().min(0).max(100),
  })
  .strict();
export type ProgressValue = z.infer<typeof progressValueSchema>;

/**
 * Computes progress percentage (0..100) for an item based on settings and referenced status columns.
 */
export function computeProgress(
  item: { values?: Record<string, unknown> },
  settings: ProgressSettings,
  statusColumns?: Record<string, { labels: StatusLabel[] }>,
): number {
  const cols = settings.related_columns.columns;
  const activeEntries = Object.entries(cols).filter(([, cfg]) => cfg.isSelected);
  if (activeEntries.length === 0) return 0;

  let totalWeight = 0;
  let earnedWeight = 0;

  for (const [colId, config] of activeEntries) {
    const weight = settings.related_columns.isNormalized ? 1 : config.percentage;
    totalWeight += weight;

    const cellVal = item.values?.[colId];
    if (!cellVal) continue;

    const parsed = statusValueSchema.safeParse(cellVal);
    if (!parsed.success) continue;

    const colLabels = statusColumns?.[colId]?.labels;
    if (!colLabels) continue;

    const matchedLabel = findStatusLabel(parsed.data, { labels: colLabels });
    if (matchedLabel?.isDone) {
      earnedWeight += weight;
    }
  }

  if (totalWeight === 0) return 0;
  return Math.round((earnedWeight / totalWeight) * 100);
}

export const progressColumn = defineColumnType<ProgressSettings, ProgressValue>({
  type: 'progress',
  label: 'Progress',
  derived: true,
  settingsSchema: progressSettingsSchema,
  valueSchema: progressValueSchema,
  summaries: [
    'count',
    'count_filled',
    'count_empty',
    'percent_filled',
    'average',
    'min',
    'max',
    'sum',
  ],
  defaultSettings: () => ({
    related_columns: {
      isNormalized: true,
      columns: {},
    },
  }),
  toText: (value) => `${value.progress}%`,
  compare: (a, b) => a.progress - b.progress,
  compute: (ctx, settings) => {
    const statusCols: Record<string, { labels: StatusLabel[] }> = {};
    for (const col of ctx.columns) {
      if (col.type === 'status') {
        const parsed = statusSettingsSchema.safeParse(col.settings);
        if (parsed.success) {
          statusCols[col.id] = parsed.data;
        }
      }
    }
    return { progress: computeProgress(ctx.item, settings, statusCols) };
  },
});
