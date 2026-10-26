import { z } from 'zod';
import { defineColumnType } from './registry';

export const dropdownLabelSchema = z.object({
  id: z.number().int().min(0),
  label: z.string().min(1).max(60),
});
export type DropdownLabel = z.infer<typeof dropdownLabelSchema>;

export const dropdownSettingsSchema = z
  .object({
    labels: z.array(dropdownLabelSchema).max(200),
    /** Allow only one selected label. */
    limitSelect: z.boolean().default(false),
  })
  .superRefine((settings, ctx) => {
    const ids = new Set<number>();
    settings.labels.forEach((label, i) => {
      if (ids.has(label.id)) {
        ctx.addIssue({ code: 'custom', path: ['labels', i, 'id'], message: 'Duplicate label id' });
      }
      ids.add(label.id);
    });
  });
export type DropdownSettings = z.infer<typeof dropdownSettingsSchema>;

/** monday dropdown value: `{"ids":[1,2]}` - label ids from the column settings. */
export const dropdownValueSchema = z.object({
  ids: z.array(z.number().int().min(0)).max(200),
});
export type DropdownValue = z.infer<typeof dropdownValueSchema>;

const labelTexts = (value: DropdownValue, settings: DropdownSettings): string[] =>
  value.ids
    .map((id) => settings.labels.find((l) => l.id === id)?.label)
    .filter((label): label is string => label !== undefined);

export const dropdownColumn = defineColumnType<DropdownSettings, DropdownValue>({
  type: 'dropdown',
  label: 'Dropdown',
  settingsSchema: dropdownSettingsSchema,
  valueSchema: dropdownValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled', 'distribution'],
  defaultSettings: () => ({ labels: [], limitSelect: false }),
  toText: (value, settings) => labelTexts(value, settings).join(', '),
  compare: (a, b, settings) =>
    labelTexts(a, settings)
      .join(', ')
      .localeCompare(labelTexts(b, settings).join(', '), undefined, { sensitivity: 'base' }),
});
