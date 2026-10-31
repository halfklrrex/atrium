import { z } from 'zod';
import { boardRelationValueSchema } from './board-relation';
import { dateValueSchema } from './date';
import { numbersValueSchema, numericOf } from './numbers';
import type { ColumnTypeRegistry } from './registry';
import { defineColumnType } from './registry';

export const mirrorSettingsSchema = z
  .object({
    relationColumnId: z.string().max(64).default(''),
    targetColumnIds: z.record(z.string().min(1).max(128), z.string().min(1).max(64)).default({}),
    aggregation: z
      .enum([
        'none',
        'count',
        'count_filled',
        'count_empty',
        'percent_filled',
        'sum',
        'average',
        'min',
        'max',
        'earliest',
        'latest',
      ])
      .default('none'),
  })
  .strict();
export type MirrorSettings = z.infer<typeof mirrorSettingsSchema>;

export const mirrorValueSchema = z
  .object({
    mirroredValues: z.array(z.unknown()),
    displayValue: z.string(),
  })
  .strict();
export type MirrorValue = z.infer<typeof mirrorValueSchema>;

export interface ConnectedItem {
  id: string;
  boardId: string;
  state?: 'active' | 'archived' | 'trash';
  values?: Record<string, unknown>;
}

export interface TargetColumnDef {
  id: string;
  type: string;
  settings?: unknown;
}

interface MirroredEntry {
  raw: unknown;
  text: string;
  targetCol?: TargetColumnDef;
}

function compareEntries(a: MirroredEntry, b: MirroredEntry, registry?: ColumnTypeRegistry): number {
  if (
    a.targetCol &&
    b.targetCol &&
    a.targetCol.type === b.targetCol.type &&
    registry?.has(a.targetCol.type)
  ) {
    const colDef = registry.get(a.targetCol.type);
    const parsedA = colDef.valueSchema.safeParse(a.raw);
    const parsedB = colDef.valueSchema.safeParse(b.raw);
    if (parsedA.success && parsedB.success) {
      return colDef.compare(parsedA.data, parsedB.data, a.targetCol.settings as never);
    }
  }

  const dateA = dateValueSchema.safeParse(a.raw);
  const dateB = dateValueSchema.safeParse(b.raw);
  if (dateA.success && dateB.success) {
    const keyA = `${dateA.data.date}T${dateA.data.time ?? '00:00:00'}`;
    const keyB = `${dateB.data.date}T${dateB.data.time ?? '00:00:00'}`;
    return keyA.localeCompare(keyB);
  }

  if (typeof a.raw === 'string' && typeof b.raw === 'string') {
    const timeA = Date.parse(a.raw);
    const timeB = Date.parse(b.raw);
    if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) {
      return timeA - timeB;
    }
  }

  return a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Derives mirror column values from connected board item records.
 * Renders values through the column registry and applies the requested aggregation.
 */
export function computeMirror(
  item: { values?: Record<string, unknown> },
  settings: MirrorSettings,
  connectedItems: Record<string, ConnectedItem>,
  targetColumns?: Record<string, TargetColumnDef>,
  registry?: ColumnTypeRegistry,
): MirrorValue {
  if (!settings.relationColumnId) {
    return { mirroredValues: [], displayValue: '' };
  }

  const rawRelation = item.values?.[settings.relationColumnId];
  const relationParsed = boardRelationValueSchema.safeParse(rawRelation);
  if (!relationParsed.success || relationParsed.data.linkedItems.length === 0) {
    return { mirroredValues: [], displayValue: '' };
  }

  const rawValues: unknown[] = [];
  const textValues: string[] = [];
  const entries: MirroredEntry[] = [];
  let totalActive = 0;
  let filledCount = 0;

  for (const ref of relationParsed.data.linkedItems) {
    const key = `${ref.boardId}:${ref.itemId}`;
    const linkedItem = connectedItems[key];
    if (!linkedItem) continue;

    // Enforce that linked item truly belongs to ref.boardId (cross-board leak prevention)
    if (linkedItem.boardId && linkedItem.boardId !== ref.boardId) continue;

    // Skip items that are not active
    if (linkedItem.state && linkedItem.state !== 'active') continue;
    totalActive += 1;

    const targetColId = settings.targetColumnIds[ref.boardId];
    if (!targetColId) continue;

    const val = linkedItem.values?.[targetColId];
    const isFilled = val !== undefined && val !== null && val !== '';

    if (isFilled) {
      filledCount += 1;
      rawValues.push(val);

      const targetCol = targetColumns?.[targetColId];
      let text: string;
      if (targetCol && registry && registry.has(targetCol.type)) {
        const parsed = registry.parseValue(targetCol.type, val);
        if (parsed.success) {
          text = registry.toText(targetCol.type, parsed.data, targetCol.settings);
        } else {
          text = typeof val === 'object' ? JSON.stringify(val) : String(val);
        }
      } else {
        text = typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
      textValues.push(text);
      entries.push({ raw: val, text, targetCol });
    }
  }

  let display = textValues.join(', ');

  switch (settings.aggregation) {
    case 'count': {
      display = String(totalActive);
      break;
    }
    case 'count_filled': {
      display = String(filledCount);
      break;
    }
    case 'count_empty': {
      display = String(Math.max(0, totalActive - filledCount));
      break;
    }
    case 'percent_filled': {
      const pct = totalActive > 0 ? Math.round((filledCount / totalActive) * 100) : 0;
      display = `${pct}%`;
      break;
    }
    case 'sum': {
      const nums = rawValues
        .map((v) => numbersValueSchema.safeParse(v))
        .filter((r) => r.success)
        .map((r) => numericOf(r.data));
      const sum = nums.reduce((acc, n) => acc + n, 0);
      display = String(sum);
      break;
    }
    case 'average': {
      const nums = rawValues
        .map((v) => numbersValueSchema.safeParse(v))
        .filter((r) => r.success)
        .map((r) => numericOf(r.data));
      const avg = nums.length > 0 ? nums.reduce((acc, n) => acc + n, 0) / nums.length : 0;
      display = String(Math.round(avg * 100) / 100);
      break;
    }
    case 'min': {
      const nums = rawValues
        .map((v) => numbersValueSchema.safeParse(v))
        .filter((r) => r.success)
        .map((r) => numericOf(r.data));
      if (nums.length > 0) {
        display = String(Math.min(...nums));
      } else if (textValues.length > 0) {
        display = [...textValues].sort((a, b) => a.localeCompare(b))[0] ?? '';
      } else {
        display = '';
      }
      break;
    }
    case 'max': {
      const nums = rawValues
        .map((v) => numbersValueSchema.safeParse(v))
        .filter((r) => r.success)
        .map((r) => numericOf(r.data));
      if (nums.length > 0) {
        display = String(Math.max(...nums));
      } else if (textValues.length > 0) {
        const sorted = [...textValues].sort((a, b) => a.localeCompare(b));
        display = sorted[sorted.length - 1] ?? '';
      } else {
        display = '';
      }
      break;
    }
    case 'earliest': {
      if (entries.length === 0) {
        display = '';
      } else {
        const sorted = [...entries].sort((a, b) => compareEntries(a, b, registry));
        display = sorted[0]?.text ?? '';
      }
      break;
    }
    case 'latest': {
      if (entries.length === 0) {
        display = '';
      } else {
        const sorted = [...entries].sort((a, b) => compareEntries(a, b, registry));
        display = sorted[sorted.length - 1]?.text ?? '';
      }
      break;
    }
    case 'none':
    default:
      break;
  }

  return {
    mirroredValues: rawValues,
    displayValue: display,
  };
}

export const mirrorColumn = defineColumnType<MirrorSettings, MirrorValue>({
  type: 'mirror',
  label: 'Mirror',
  // Computed in the web cell from the linked items (read asynchronously); nothing is stored.
  derived: true,
  compute: () => null,
  settingsSchema: mirrorSettingsSchema,
  valueSchema: mirrorValueSchema,
  summaries: ['count', 'count_filled', 'count_empty', 'percent_filled'],
  defaultSettings: () => ({
    relationColumnId: '',
    targetColumnIds: {},
    aggregation: 'none',
  }),
  toText: (value) => value.displayValue,
  compare: (a, b) =>
    a.displayValue.localeCompare(b.displayValue, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
});
