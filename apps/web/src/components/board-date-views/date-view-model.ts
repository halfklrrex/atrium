/**
 * Pieces the Calendar and Timeline models share: which items a date view shows (filters, search,
 * order), the days an item covers in its date or timeline column, what colours it and the legend.
 * Pure: no React and no Firebase.
 */
import {
  columnRegistry,
  matchesFilter,
  sortItems,
  type BoardFilterState,
  type DateValue,
  type GroupDef,
  type StatusSettings,
  type TimelineValue,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';
import { comparePositions } from '../../lib/positions';
import { cardLabel } from '../board-kanban/kanban-model';
import { itemMatchesSearch, type ColumnView } from '../board-table/table-model';

/** The days an item covers: one day for a date column, from..to for a timeline column. */
export interface DaySpan {
  from: string;
  to: string;
  /** `HH:MM` of a date value that has a time. */
  time: string | null;
  /** True for a timeline value (it can span several days). */
  isRange: boolean;
}

export interface LegendEntry {
  key: string;
  name: string;
  color: string;
}

/** A column's new value for an item that has not been written yet (an optimistic patch, by item id). */
export type DatePatches = Readonly<Record<string, unknown>>;

/** The status columns a date view can colour by. */
export const statusColumns = (columns: readonly ColumnView[]): ColumnView[] =>
  columns.filter((c) => c.def.type === 'status');

/** The status column that colours the items, when the saved one still exists. */
export function resolveColorColumn(
  columns: readonly ColumnView[],
  colorBy: string | null,
): ColumnView | null {
  return statusColumns(columns).find((c) => c.def.id === colorBy) ?? null;
}

/** The days an item covers in `column`, or `null` when it has no (valid) value there. */
export function itemSpan(item: ItemDoc, column: ColumnView, override?: unknown): DaySpan | null {
  const raw = override !== undefined ? override : item.values[column.def.id];
  if (raw === null || raw === undefined) return null;
  const parsed = columnRegistry.parseValue(column.def.type, raw);
  if (!parsed.success) return null;
  if (column.def.type === 'timeline') {
    const value = parsed.data as TimelineValue;
    return { from: value.from, to: value.to, time: null, isRange: true };
  }
  const value = parsed.data as DateValue;
  return {
    from: value.date,
    to: value.date,
    time: value.time?.slice(0, 5) ?? null,
    isRange: false,
  };
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Black or white text, whichever reads better on `hex` (WCAG relative luminance). */
export function textToneFor(hex: string | null): 'dark' | 'light' {
  if (!hex || !HEX.test(hex)) return 'dark';
  const full = hex.length === 4 ? `#${[1, 2, 3].map((i) => hex[i]! + hex[i]!).join('')}` : hex;
  const channel = (offset: number) => {
    const c = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // White text reaches 4.5:1 up to about this luminance.
  return luminance > 0.18 ? 'dark' : 'light';
}

/** The value a new item gets for a day: a date, or a one-day timeline. */
export function valueForDay(column: ColumnView, day: string): DateValue | TimelineValue {
  return column.def.type === 'timeline' ? { from: day, to: day } : { date: day };
}

export interface SelectItemsInput {
  items: readonly ItemDoc[];
  /** Every board column (filters and search read all of them). */
  columns: readonly ColumnView[];
  filterState?: BoardFilterState;
  /** Trimmed search term; empty = none. */
  search: string;
}

/** The top-level items that pass search and filters, in the view's order (positions, or its sort). */
export function selectItems({ items, columns, filterState, search }: SelectItemsInput): ItemDoc[] {
  const defs = columns.map((c) => ({
    ...c.def,
    settings: (c.settings as Record<string, unknown>) ?? c.def.settings,
  }));
  const needle = search.trim();
  let shown = items.filter((item) => {
    if (item.parentItemId !== null && item.parentItemId !== undefined) return false;
    if (needle && !itemMatchesSearch(item, columns, needle)) return false;
    return (
      !filterState ||
      matchesFilter(item, filterState.filterGroup, null, filterState.personIds, defs)
    );
  });
  shown = [...shown].sort(comparePositions);
  if (filterState && filterState.sortConditions.length > 0) {
    shown = sortItems(shown, filterState.sortConditions, defs) as ItemDoc[];
  }
  return shown;
}

/** The colour of an item: its status label's, or its group's; `null` = the neutral token. */
export function itemColor(
  item: ItemDoc,
  colorColumn: ColumnView | null,
  groupColor: ReadonlyMap<string, string>,
): string | null {
  if (colorColumn) return cardLabel(item, colorColumn)?.color ?? null;
  return groupColor.get(item.groupId) ?? null;
}

/** The legend: one entry per status label when coloured by a status column, else one per group. */
export function buildLegend(
  colorColumn: ColumnView | null,
  groups: readonly GroupDef[],
): LegendEntry[] {
  return colorColumn
    ? (colorColumn.settings as StatusSettings).labels
        .filter((l) => l.label.trim() !== '')
        .sort((a, b) => a.index - b.index)
        .map((l) => ({ key: l.id, name: l.label, color: l.color }))
    : [...groups].sort(comparePositions).map((g) => ({ key: g.id, name: g.title, color: g.color }));
}
