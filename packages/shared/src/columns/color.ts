import { z } from 'zod';
import { defineColumnType } from './registry';

export const colorSettingsSchema = z.object({}).strict();
export type ColorSettings = z.infer<typeof colorSettingsSchema>;

/**
 * monday color_picker column value: `{"color": {"hex": "#FF5733"}}`.
 * Supports standard 3, 6, or 8 digit hex color codes.
 */
export const colorValueSchema = z
  .object({
    color: z
      .object({
        hex: z
          .string()
          .regex(
            /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
            'Expected a valid hex color code (e.g. #FF5733)',
          ),
      })
      .strict(),
  })
  .strict();
export type ColorValue = z.infer<typeof colorValueSchema>;

export const colorPickerColumn = defineColumnType<ColorSettings, ColorValue>({
  type: 'color_picker',
  label: 'Color Picker',
  settingsSchema: colorSettingsSchema,
  valueSchema: colorValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({}),
  toText: (value) => value.color.hex.toUpperCase(),
  compare: (a, b) =>
    a.color.hex
      .toUpperCase()
      .localeCompare(b.color.hex.toUpperCase(), undefined, { sensitivity: 'base' }),
});
