import { z } from 'zod';
import { hexColorSchema } from '../schemas/common';
import { defineColumnType } from './registry';
import type { DistributionSegment } from './types';

/** One selectable status label. `index` is what cell values reference; it never changes once issued. */
export const statusLabelSchema = z.object({
  id: z.string().min(1).max(64),
  index: z.number().int().min(0),
  label: z.string().max(60),
  color: hexColorSchema,
  /** Marks the label as "complete" for progress roll-ups (monday: "done" flag). */
  isDone: z.boolean().optional(),
});
export type StatusLabel = z.infer<typeof statusLabelSchema>;

export const statusSettingsSchema = z
  .object({
    labels: z.array(statusLabelSchema).min(1).max(40),
  })
  .superRefine((settings, ctx) => {
    const ids = new Set<string>();
    const indexes = new Set<number>();
    settings.labels.forEach((label, i) => {
      if (ids.has(label.id)) {
        ctx.addIssue({ code: 'custom', path: ['labels', i, 'id'], message: 'Duplicate label id' });
      }
      if (indexes.has(label.index)) {
        ctx.addIssue({
          code: 'custom',
          path: ['labels', i, 'index'],
          message: 'Duplicate label index',
        });
      }
      ids.add(label.id);
      indexes.add(label.index);
    });
  });
export type StatusSettings = z.infer<typeof statusSettingsSchema>;

/** monday-style status value: reference a label by `index` (preferred) or by `label` text. */
export const statusValueSchema = z
  .object({
    index: z.number().int().min(0).optional(),
    label: z.string().max(60).optional(),
  })
  .refine((v) => v.index !== undefined || v.label !== undefined, {
    message: 'Status value needs an index or a label',
  });
export type StatusValue = z.infer<typeof statusValueSchema>;

/** Resolve the label a value points at; `index` wins over `label` text. */
export function findStatusLabel(value: StatusValue, settings: StatusSettings): StatusLabel | null {
  if (value.index !== undefined) {
    const byIndex = settings.labels.find((l) => l.index === value.index);
    if (byIndex) return byIndex;
  }
  if (value.label !== undefined) {
    const wanted = value.label.trim().toLowerCase();
    return settings.labels.find((l) => l.label.trim().toLowerCase() === wanted) ?? null;
  }
  return null;
}

export const DEFAULT_STATUS_LABELS: readonly StatusLabel[] = [
  { id: 'working-on-it', index: 0, label: 'Working on it', color: '#fdab3d' },
  { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
  { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
];

/** monday's grey for a cell without a status (`explosive`). */
export const EMPTY_STATUS_COLOR = '#c4c4c4';

/** Slice key for cells with no status (or a status whose label text is blank). */
export const EMPTY_STATUS_KEY = '__empty';

/**
 * Footer battery of a status column: one segment per label that is in use, in label order, with
 * the "no value" cells as one grey segment last. Labels with blank text count as that empty segment.
 */
export function statusDistribution(
  values: readonly (StatusValue | null | undefined)[],
  settings: StatusSettings,
): { total: number; segments: DistributionSegment[] } {
  const counts = new Map<string, number>();
  let empty = 0;
  for (const value of values) {
    const label = value ? findStatusLabel(value, settings) : null;
    if (!label || label.label.trim() === '') empty += 1;
    else counts.set(label.id, (counts.get(label.id) ?? 0) + 1);
  }
  const segments: DistributionSegment[] = [...settings.labels]
    .sort((a, b) => a.index - b.index)
    .flatMap((label) => {
      const count = counts.get(label.id) ?? 0;
      return count > 0 ? [{ key: label.id, label: label.label, color: label.color, count }] : [];
    });
  if (empty > 0) {
    segments.push({ key: EMPTY_STATUS_KEY, label: '', color: EMPTY_STATUS_COLOR, count: empty });
  }
  return { total: values.length, segments };
}

export const statusColumn = defineColumnType<StatusSettings, StatusValue>({
  type: 'status',
  label: 'Status',
  settingsSchema: statusSettingsSchema,
  valueSchema: statusValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled', 'distribution'],
  defaultSettings: () => ({ labels: DEFAULT_STATUS_LABELS.map((l) => ({ ...l })) }),
  aggregate: (values, settings) => ({
    kind: 'distribution',
    ...statusDistribution(values, settings),
  }),
  toText: (value, settings) => findStatusLabel(value, settings)?.label ?? value.label ?? '',
  validateValue: (value, settings) => {
    if (findStatusLabel(value, settings)) return { ok: true };
    // A blank label with no index is an empty status.
    if (value.index === undefined && (value.label ?? '').trim() === '') return { ok: true };
    return { ok: false, message: 'Status value does not match any label of the column' };
  },
  compare: (a, b, settings) => {
    const ia = findStatusLabel(a, settings)?.index ?? Number.MAX_SAFE_INTEGER;
    const ib = findStatusLabel(b, settings)?.index ?? Number.MAX_SAFE_INTEGER;
    return ia - ib;
  },
});
