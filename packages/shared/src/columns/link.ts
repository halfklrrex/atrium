import { z } from 'zod';
import { defineColumnType } from './registry';

export const linkSettingsSchema = z.object({}).strict();
export type LinkSettings = z.infer<typeof linkSettingsSchema>;

/** Allowed schemes: `javascript:`, `data:` and friends are rejected by construction. */
const SAFE_URL = /^(https?:\/\/[^\s/?#]+[^\s]*|mailto:[^\s]+|tel:[+\d\s().-]+)$/i;

/** A URL with a safe protocol - `javascript:` and `data:` links must never reach an `href`. */
export const safeUrlSchema = z
  .string()
  .max(2048)
  .regex(SAFE_URL, 'Expected an http(s), mailto or tel link');

/** monday link value: `{"url":"https://example.com","text":"Example"}`. */
export const linkValueSchema = z.object({
  url: safeUrlSchema,
  text: z.string().max(256).optional(),
});
export type LinkValue = z.infer<typeof linkValueSchema>;

export const linkColumn = defineColumnType<LinkSettings, LinkValue>({
  type: 'link',
  label: 'Link',
  settingsSchema: linkSettingsSchema,
  valueSchema: linkValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({}),
  toText: (value) => (value.text ? `${value.text} - ${value.url}` : value.url),
  compare: (a, b) =>
    (a.text || a.url).localeCompare(b.text || b.url, undefined, { sensitivity: 'base' }),
});
