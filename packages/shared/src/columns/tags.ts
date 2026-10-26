import { z } from 'zod';
import { defineColumnType } from './registry';

export const tagDefinitionSchema = z
  .object({
    id: z.number().int(),
    name: z.string().min(1).max(100),
    color: z.string().optional(),
  })
  .strict();
export type TagDefinition = z.infer<typeof tagDefinitionSchema>;

export const tagsSettingsSchema = z
  .object({
    tags: z.array(tagDefinitionSchema).default([]),
  })
  .strict();
export type TagsSettings = z.infer<typeof tagsSettingsSchema>;

/**
 * monday tags column value: `{"tag_ids": [1, 2]}`.
 * Empty tag selections are allowed as `{"tag_ids": []}` and treated as empty.
 */
export const tagsValueSchema = z
  .object({
    tag_ids: z.array(z.number().int()).max(200),
  })
  .strict();
export type TagsValue = z.infer<typeof tagsValueSchema>;

function formatTags(value: TagsValue, settings: TagsSettings): string {
  if (!value.tag_ids || value.tag_ids.length === 0) return '';
  const tagMap = new Map((settings?.tags ?? []).map((t) => [t.id, t.name]));
  return value.tag_ids.map((id) => tagMap.get(id) ?? String(id)).join(', ');
}

export const tagsColumn = defineColumnType<TagsSettings, TagsValue>({
  type: 'tags',
  label: 'Tags',
  settingsSchema: tagsSettingsSchema,
  valueSchema: tagsValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({ tags: [] }),
  toText: formatTags,
  compare: (a, b, settings) =>
    formatTags(a, settings).localeCompare(formatTags(b, settings), undefined, {
      sensitivity: 'base',
    }),
});
