import { z } from 'zod';
import { defineColumnType } from './registry';

export const numbersSettingsSchema = z
  .object({
    /** Unit shown next to the number, e.g. `$` on the left or `kg` on the right. */
    unit: z
      .object({
        symbol: z.string().max(8),
        direction: z.enum(['left', 'right']),
      })
      .nullable()
      .default(null),
    /** Fixed number of decimals; `null` shows the number as entered. */
    decimals: z.number().int().min(0).max(8).nullable().default(null),
  })
  .strict();
export type NumbersSettings = z.infer<typeof numbersSettingsSchema>;

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** monday sends numbers as numeric strings (`"42"`); plain finite numbers are accepted as well. */
export const numbersValueSchema = z.union([
  z.number().finite(),
  z.string().regex(NUMERIC, 'Expected a number'),
]);
export type NumbersValue = z.infer<typeof numbersValueSchema>;

export const numericOf = (value: NumbersValue): number =>
  typeof value === 'number' ? value : Number(value);

export const numbersColumn = defineColumnType<NumbersSettings, NumbersValue>({
  type: 'numbers',
  label: 'Numbers',
  settingsSchema: numbersSettingsSchema,
  valueSchema: numbersValueSchema,
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
  defaultSettings: () => ({ unit: null, decimals: null }),
  aggregate: (values) => {
    let sum = 0;
    let count = 0;
    for (const value of values) {
      if (value === null || value === undefined) continue;
      sum += numericOf(value);
      count += 1;
    }
    return { kind: 'sum', sum, count };
  },
  toText: (value, settings) => {
    const n = numericOf(value);
    const body = settings.decimals === null ? String(n) : n.toFixed(settings.decimals);
    if (!settings.unit) return body;
    return settings.unit.direction === 'left'
      ? `${settings.unit.symbol}${body}`
      : `${body}${settings.unit.symbol}`;
  },
  compare: (a, b) => numericOf(a) - numericOf(b),
});
