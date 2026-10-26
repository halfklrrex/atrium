import { z } from 'zod';
import { defineColumnType } from './registry';

export const emailSettingsSchema = z.object({}).strict();
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

/**
 * monday email column value: `{"email": "user@example.com", "text": "John Doe"}`.
 */
export const emailValueSchema = z
  .object({
    email: z.email('Expected a valid email address').max(320),
    text: z.string().max(256).optional(),
  })
  .strict();
export type EmailValue = z.infer<typeof emailValueSchema>;

export const emailColumn = defineColumnType<EmailSettings, EmailValue>({
  type: 'email',
  label: 'Email',
  settingsSchema: emailSettingsSchema,
  valueSchema: emailValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({}),
  toText: (value) => (value.text ? `${value.text} <${value.email}>` : value.email),
  compare: (a, b) => {
    const textA = a.text || a.email;
    const textB = b.text || b.email;
    return textA.localeCompare(textB, undefined, { sensitivity: 'base' });
  },
});
