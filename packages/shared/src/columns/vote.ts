import { z } from 'zod';
import { defineColumnType } from './registry';

export const voteSettingsSchema = z.object({}).strict();
export type VoteSettings = z.infer<typeof voteSettingsSchema>;

/**
 * monday vote column value: `{"votersIds": ["uid1", "uid2"]}`.
 * The vote count is votersIds.length.
 */
export const voteValueSchema = z
  .object({
    votersIds: z
      .array(z.string().min(1).max(128))
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length, 'votersIds must be unique'),
  })
  .strict();
export type VoteValue = z.infer<typeof voteValueSchema>;

export const voteColumn = defineColumnType<VoteSettings, VoteValue>({
  type: 'vote',
  label: 'Vote',
  settingsSchema: voteSettingsSchema,
  valueSchema: voteValueSchema,
  summaries: [
    'count',
    'count_filled',
    'count_empty',
    'percent_filled',
    'sum',
    'average',
    'min',
    'max',
  ],
  defaultSettings: () => ({}),
  toText: (value) => String(value.votersIds.length),
  compare: (a, b) => a.votersIds.length - b.votersIds.length,
});
