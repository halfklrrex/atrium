import type { ItemDoc } from '../../data';
import { isRowDone } from '../board-table/table-env';
import type { ColumnView } from '../board-table/table-model';

export type KeySlot = 'status' | 'owner' | 'due' | 'priority';

/** How many grid fields show before "Show all fields (N)". */
export const GRID_FIELD_CAP = 10;

/** A description up to this many lines shows in full. */
export const DESCRIPTION_FULL_LINES = 12;

/** A longer one clamps to this many lines; must match `--atrium-item-panel-desc-clamp-lines`. */
export const DESCRIPTION_CLAMP_LINES = 8;

/** Types whose value needs the whole row of the fields grid. */
export const WIDE_FIELD_TYPES: ReadonlySet<string> = new Set(['long_text', 'link', 'files']);

export const isWideFieldType = (type: string): boolean => WIDE_FIELD_TYPES.has(type);

/**
 * The key bar's columns by the slot rule, in slot order; dropped slots are left out and a column
 * never fills two slots.
 *
 * 1 status: first `status`. 2 owner: first `people`. 3 due: first `date`, else first `timeline`.
 * 4 priority: second `status`, else first `dropdown`.
 */
export function selectKeyBarColumns(
  columns: readonly ColumnView[],
): { slot: KeySlot; column: ColumnView }[] {
  const ofType = (type: string) => columns.filter((c) => c.def.type === type);
  const statuses = ofType('status');
  const picks: [KeySlot, ColumnView | undefined][] = [
    ['status', statuses[0]],
    ['owner', ofType('people')[0]],
    ['due', ofType('date')[0] ?? ofType('timeline')[0]],
    ['priority', statuses[1] ?? ofType('dropdown')[0]],
  ];
  const used = new Set<string>();
  const result: { slot: KeySlot; column: ColumnView }[] = [];
  for (const [slot, column] of picks) {
    if (!column || used.has(column.def.id)) continue;
    used.add(column.def.id);
    result.push({ slot, column });
  }
  return result;
}

/** The grid's fields: board order, key-bar columns removed, capped unless expanded. */
export function partitionGridFields(
  columns: readonly ColumnView[],
  keyBarIds: ReadonlySet<string>,
  options: { expanded: boolean; cap?: number },
): { visible: ColumnView[]; total: number; hasMore: boolean } {
  const cap = options.cap ?? GRID_FIELD_CAP;
  const all = columns.filter((c) => !keyBarIds.has(c.def.id));
  const hasMore = all.length > cap;
  return {
    visible: options.expanded || !hasMore ? all : all.slice(0, cap),
    total: all.length,
    hasMore,
  };
}

const KEY_BAR_HINTS: Record<string, string> = {
  status: 'Set status',
  people: 'Assign',
  date: 'Set date',
  timeline: 'Set dates',
  dropdown: 'Choose',
};

/** Key-bar empty hint per type, or undefined for types the bar never holds. */
export function keyBarEmptyHint(type: string): string | undefined {
  return KEY_BAR_HINTS[type];
}

/** 'full' up to DESCRIPTION_FULL_LINES lines, else 'clamped'. A lineHeight of 0 is 'full'. */
export function descriptionMode(contentHeight: number, lineHeight: number): 'full' | 'clamped' {
  if (!(lineHeight > 0)) return 'full';
  // Rounding keeps sub-pixel noise in the measured height from tipping a 12-line text over.
  return Math.round(contentHeight / lineHeight) > DESCRIPTION_FULL_LINES ? 'clamped' : 'full';
}

/** Total subitems of the parent and how many are done (null `done` without a status column). */
export function subitemSummary(
  items: readonly ItemDoc[],
  parentId: string,
  subitemColumns: readonly ColumnView[],
): { total: number; done: number | null } {
  const subs = items.filter((i) => i.parentItemId === parentId);
  const hasStatus = subitemColumns.some((c) => c.def.type === 'status');
  return {
    total: subs.length,
    done: hasStatus ? subs.filter((s) => isRowDone(s, subitemColumns)).length : null,
  };
}
