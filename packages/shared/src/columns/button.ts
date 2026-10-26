import { z } from 'zod';
import { hexColorSchema } from '../schemas/common';
import { defineColumnType } from './registry';

export const buttonSettingsSchema = z
  .object({
    /** Label displayed inside the button (e.g. "Run", "Approve", "Submit"). */
    label: z.string().min(1).max(50).default('Click'),
    /** Button color matching Atrium's status/group palette. */
    color: hexColorSchema.default('#579bfc'),
  })
  .strict();
export type ButtonSettings = z.infer<typeof buttonSettingsSchema>;

/**
 * Button column has no stored cell value. Label and colour live in column settings.
 * Button clicks execute through a backend callable that verifies edit permissions
 * and appends an event to `boards/{id}/activity`.
 */
export const buttonValueSchema = z.object({}).strict();
export type ButtonValue = z.infer<typeof buttonValueSchema>;

export const buttonColumn = defineColumnType<ButtonSettings, ButtonValue>({
  type: 'button',
  label: 'Button',
  // FW2: clicks go through a callable; clients never write the cell.
  serverManaged: true,
  settingsSchema: buttonSettingsSchema,
  valueSchema: buttonValueSchema,
  summaries: ['count', 'count_empty'],
  defaultSettings: () => ({
    label: 'Click',
    color: '#579bfc',
  }),
  toText: (_value, settings) => settings.label,
  compare: () => 0,
});
