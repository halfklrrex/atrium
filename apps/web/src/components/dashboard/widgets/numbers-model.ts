/**
 * Numbers widget model (P6): one big number, the count, sum, average, minimum or maximum of a
 * column across the widget's boards, optionally limited to items with one of several status
 * labels. Pure: no React and no Firebase.
 *
 * Cross-board rules (see `widget-columns.ts`): the value column and the filter column are matched
 * on each board by id, then by type and title. Status filter labels are stored as label ids; since
 * ids differ between boards, an item matches when its label text equals the text of a chosen label
 * (case-insensitive), the same merge by label text the Chart widget uses.
 */
import type { ColumnDef, DashboardWidget, StatusSettings } from '@atrium/shared';
import {
  readNumber,
  readStatusLabel,
  resolveColumn,
  widgetBoards,
  type WidgetBoardData,
} from './widget-columns';

export type NumbersSettings = Extract<DashboardWidget, { type: 'numbers' }>['settings'];
export type NumbersMode = NumbersSettings['mode'];

export const NUMBERS_MODE_LABELS: Record<NumbersMode, string> = {
  count: 'Count of items',
  sum: 'Sum',
  average: 'Average',
  min: 'Minimum',
  max: 'Maximum',
};

export interface NumbersModel {
  /** `null` when there is nothing to compute (average, min or max of no numbers). */
  value: number | null;
  /** Items that passed the filter. */
  itemCount: number;
  /** Items that had a number in the column (equals `itemCount` for a count). */
  numberCount: number;
  caption: string;
  /** True when the column is gone from every board, so the widget fell back to a count. */
  fellBack: boolean;
  /** Screen reader text. */
  summary: string;
}

const lower = (text: string): string => text.trim().toLowerCase();

/** Lower-cased texts of the filter labels, taken from whichever board defines the filter column. */
export function filterTexts(
  boards: readonly WidgetBoardData[],
  filter: NonNullable<NumbersSettings['filter']>,
): Set<string> {
  const wanted = new Set(filter.values);
  const texts = new Set<string>();
  for (const { board } of boards) {
    const def = board.columns.find((c) => c.id === filter.columnId);
    if (!def || def.type !== 'status') continue;
    for (const label of (def.settings as unknown as StatusSettings).labels ?? []) {
      if (wanted.has(label.id)) texts.add(lower(label.label));
    }
  }
  return texts;
}

export function buildNumbersModel(input: {
  boards: readonly WidgetBoardData[];
  widgetBoardIds: readonly string[];
  settings: NumbersSettings;
}): NumbersModel {
  const boards = widgetBoards(input.boards, input.widgetBoardIds);
  const { settings } = input;
  const columns = boards.map((b) => b.board);

  const valueExists =
    settings.columnId !== null && columns.some((b) => resolveColumn(columns, b, settings.columnId));
  const mode: NumbersMode = settings.mode !== 'count' && !valueExists ? 'count' : settings.mode;
  const fellBack = mode !== settings.mode;

  // A filter with no labels chosen filters nothing.
  const filter = settings.filter && settings.filter.values.length > 0 ? settings.filter : null;
  const texts = filter ? filterTexts(boards, filter) : null;

  let itemCount = 0;
  let numberCount = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const { board, items } of boards) {
    const valueDef: ColumnDef | null =
      mode === 'count' ? null : resolveColumn(columns, board, settings.columnId);
    const filterDef = filter ? resolveColumn(columns, board, filter.columnId) : null;
    // A board without the filter column has nothing that can match the filter.
    if (filter && !filterDef) continue;
    // A board without the value column adds nothing to a sum, average, min or max.
    if (mode !== 'count' && !valueDef) continue;

    for (const item of items) {
      if (filterDef && texts) {
        const label = readStatusLabel(item, filterDef);
        if (!label || !texts.has(lower(label.label))) continue;
      }
      itemCount += 1;
      if (!valueDef) continue;
      const n = readNumber(board, item, valueDef);
      if (n === null) continue;
      numberCount += 1;
      sum += n;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }

  let value: number | null;
  switch (mode) {
    case 'count':
      value = itemCount;
      break;
    case 'sum':
      value = sum;
      break;
    case 'average':
      value = numberCount > 0 ? sum / numberCount : null;
      break;
    case 'min':
      value = numberCount > 0 ? min : null;
      break;
    case 'max':
      value = numberCount > 0 ? max : null;
      break;
  }

  const caption = captionFor(mode, boards, columns, settings, itemCount, numberCount);
  const shown = value === null ? 'no value' : formatNumber(value);
  return {
    value,
    itemCount,
    numberCount,
    caption,
    fellBack,
    summary: `${caption}: ${shown}`,
  };
}

function captionFor(
  mode: NumbersMode,
  boards: readonly WidgetBoardData[],
  columns: readonly WidgetBoardData['board'][],
  settings: NumbersSettings,
  itemCount: number,
  numberCount: number,
): string {
  if (mode === 'count') return itemCount === 1 ? '1 item' : `${itemCount} items`;
  let title = 'column';
  for (const { board } of boards) {
    const def = resolveColumn(columns, board, settings.columnId);
    if (def) {
      title = def.title;
      break;
    }
  }
  const verb =
    mode === 'sum' ? 'Sum' : mode === 'average' ? 'Average' : mode === 'min' ? 'Min' : 'Max';
  return numberCount === 0 ? `${verb} of ${title} (no numbers)` : `${verb} of ${title}`;
}

/** Number text for the widget: grouped thousands, at most 2 decimals. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}
