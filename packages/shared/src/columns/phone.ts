import { z } from 'zod';
import { defineColumnType } from './registry';

export const phoneSettingsSchema = z.object({}).strict();
export type PhoneSettings = z.infer<typeof phoneSettingsSchema>;

/** Allowed characters in phone number: digits, plus, spaces, dashes, dots, parentheses. */
const PHONE_REGEX = /^[+\d\s().-]{3,50}$/;

/**
 * monday phone column value: `{"phone": "+12025550169", "countryShortName": "US"}`.
 * Rejects input without at least 5 digits.
 */
export const phoneValueSchema = z
  .object({
    phone: z
      .string()
      .regex(PHONE_REGEX, 'Expected a valid phone number (digits, +, -, (), spaces)')
      .refine(
        (s) => s.replace(/\D/g, '').length >= 5,
        'Phone number must contain at least 5 digits',
      ),
    countryShortName: z.string().length(2).toUpperCase().optional(),
  })
  .strict();
export type PhoneValue = z.infer<typeof phoneValueSchema>;

export const phoneColumn = defineColumnType<PhoneSettings, PhoneValue>({
  type: 'phone',
  label: 'Phone',
  settingsSchema: phoneSettingsSchema,
  valueSchema: phoneValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({}),
  toText: (value) => value.phone,
  compare: (a, b) =>
    a.phone.localeCompare(b.phone, undefined, { numeric: true, sensitivity: 'base' }),
});
