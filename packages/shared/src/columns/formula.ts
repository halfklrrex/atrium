import { z } from 'zod';
import {
  type CellResolver,
  createCellResolver,
  evaluate,
  evaluateRow,
  isFormulaError,
} from '../formula';
import type { ColumnDef } from '../schemas/board';
import { defineColumnType } from './registry';

export const formulaSettingsSchema = z
  .object({
    expression: z.string().default(''),
    outputType: z.enum(['number', 'text', 'date', 'boolean']).default('text'),
    decimalPlaces: z.number().int().min(0).max(10).optional(),
    currencySymbol: z.string().optional(),
  })
  .strict();
export type FormulaSettings = z.infer<typeof formulaSettingsSchema>;

export const formulaValueSchema = z.union([z.string(), z.number(), z.boolean()]).nullable();
export type FormulaValue = z.infer<typeof formulaValueSchema>;

/**
 * Computes the raw, typed result of a formula expression against item values or a cell resolver.
 */
export function computeFormulaRaw(
  item: { values?: Record<string, unknown> },
  settings: FormulaSettings,
  resolverOrColumnNameMap?: CellResolver,
): unknown {
  if (!settings.expression) return null;
  const resolver: CellResolver =
    typeof resolverOrColumnNameMap === 'function' ? resolverOrColumnNameMap : (item.values ?? {});
  const colNameMap =
    typeof resolverOrColumnNameMap === 'object' && resolverOrColumnNameMap !== null
      ? (resolverOrColumnNameMap as Record<string, string>)
      : undefined;
  return evaluate(settings.expression, resolver, colNameMap);
}

/**
 * Formats a raw formula computation result into a display string according to settings.
 */
export function formatFormulaResult(
  result: unknown,
  settings: FormulaSettings = { expression: '', outputType: 'text' },
): string {
  if (result === null || result === undefined) return '';
  if (isFormulaError(result)) return result;

  const outputType = settings.outputType ?? 'text';

  if (outputType === 'boolean' || typeof result === 'boolean') {
    return result ? 'true' : 'false';
  }

  if (outputType === 'number') {
    const num = typeof result === 'number' ? result : Number(result);
    if (!isNaN(num)) {
      const formatted =
        settings.decimalPlaces !== undefined ? num.toFixed(settings.decimalPlaces) : String(num);
      return settings.currencySymbol ? `${settings.currencySymbol}${formatted}` : formatted;
    }
  }

  if (typeof result === 'number') {
    const formatted =
      settings.decimalPlaces !== undefined
        ? result.toFixed(settings.decimalPlaces)
        : String(result);
    return settings.currencySymbol ? `${settings.currencySymbol}${formatted}` : formatted;
  }

  if (typeof result === 'object') {
    return JSON.stringify(result);
  }

  return String(result);
}

/**
 * Derives the computed, formatted formula output from an item's cell values.
 */
export function computeFormula(
  item: { values?: Record<string, unknown> },
  settings: FormulaSettings,
  resolverOrColumnNameMap?: CellResolver,
): string {
  const raw = computeFormulaRaw(item, settings, resolverOrColumnNameMap);
  return formatFormulaResult(raw, settings);
}

export const formulaColumn = defineColumnType<FormulaSettings, FormulaValue>({
  type: 'formula',
  label: 'Formula',
  derived: true,
  settingsSchema: formulaSettingsSchema,
  valueSchema: formulaValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({
    expression: '',
    outputType: 'text',
  }),
  toText: (value, settings) => formatFormulaResult(value, settings),
  compare: (a, b) => {
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
    if (b === null || b === undefined) return -1;

    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    if (typeof a === 'boolean' && typeof b === 'boolean') {
      return (a ? 1 : 0) - (b ? 1 : 0);
    }

    const strA = String(a);
    const strB = String(b);
    const isNumA = /^-?\d+(\.\d+)?$/.test(strA);
    const isNumB = /^-?\d+(\.\d+)?$/.test(strB);
    if (isNumA && isNumB) {
      return Number(strA) - Number(strB);
    }
    return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
  },
  compute: (ctx, settings) => {
    if (!settings.expression.trim()) return null;
    const rowEval = evaluateRow(ctx.columns as ColumnDef[], ctx.item);
    const matchingFormulaCol = (ctx.columns as ColumnDef[]).find(
      (c) =>
        c.type === 'formula' &&
        (c.settings as { expression?: string } | undefined)?.expression === settings.expression,
    );
    if (matchingFormulaCol && matchingFormulaCol.id in rowEval) {
      const val = rowEval[matchingFormulaCol.id];
      if (val === null || val === undefined) return null;
      if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') {
        return val;
      }
      return formatFormulaResult(val, settings);
    }
    const mergedValues: Record<string, unknown> = { ...(ctx.item.values ?? {}), ...rowEval };
    for (const col of ctx.columns as ColumnDef[]) {
      if (col.type === 'item_id' && typeof ctx.item.seq === 'number') {
        mergedValues[col.id] = String(ctx.item.seq);
      } else if (col.type === 'auto_number' && typeof ctx.item.boardSeq === 'number') {
        mergedValues[col.id] = { auto_number: ctx.item.boardSeq };
      }
    }
    const resolver = createCellResolver(ctx.columns as ColumnDef[], mergedValues);
    const raw = computeFormulaRaw(ctx.item, settings, resolver);
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') {
      return raw;
    }
    return formatFormulaResult(raw, settings);
  },
});
