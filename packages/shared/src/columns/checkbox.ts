import { z } from 'zod';
import { defineColumnType } from './registry';

export const checkboxSettingsSchema = z.object({}).strict();
export type CheckboxSettings = z.infer<typeof checkboxSettingsSchema>;

/** monday checkbox value: `{"checked":"true"}` (a string). Real booleans are tolerated on input. */
export const checkboxValueSchema = z.object({
  checked: z.union([z.literal('true'), z.literal('false'), z.boolean()]),
});
export type CheckboxValue = z.infer<typeof checkboxValueSchema>;

export const isChecked = (value: CheckboxValue): boolean =>
  value.checked === true || value.checked === 'true';

export const checkboxColumn = defineColumnType<CheckboxSettings, CheckboxValue>({
  type: 'checkbox',
  label: 'Checkbox',
  settingsSchema: checkboxSettingsSchema,
  valueSchema: checkboxValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({}),
  aggregate: (values) => ({
    kind: 'ratio',
    filled: values.filter((v) => v && isChecked(v)).length,
    total: values.length,
  }),
  // monday's API text for a ticked checkbox is "v"; unticked is empty.
  toText: (value) => (isChecked(value) ? 'v' : ''),
  compare: (a, b) => Number(isChecked(a)) - Number(isChecked(b)),
});
