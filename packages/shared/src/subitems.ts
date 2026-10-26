import type { ColumnDef } from './schemas/board';
import type { Item } from './schemas/item';
import { columnRegistry } from './columns';
import type { StatusSettings } from './columns';
import { DEFAULT_BOARD_STATUS_LABELS } from './boards';

/**
 * monday's default subitem columns: Owner (people), Status and Date. Ids are `sub_*` slugs and must be unique across `board.columns` and
 * `board.subitemColumns` together (derived, server-managed and locked column lists are flat), so
 * pass the ids already in use as `avoidIds`.
 */
export function defaultSubitemColumns(avoidIds: Iterable<string> = []): ColumnDef[] {
  const taken = new Set(avoidIds);
  const unique = (base: string): string => {
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`;
    taken.add(id);
    return id;
  };
  const statusSettings: StatusSettings = {
    labels: DEFAULT_BOARD_STATUS_LABELS.map((label) => ({ ...label })),
  };
  return [
    {
      id: unique('sub_owner'),
      type: 'people',
      title: 'Owner',
      position: 'a0',
      settings: columnRegistry.defaultSettings('people') as Record<string, unknown>,
    },
    {
      id: unique('sub_status'),
      type: 'status',
      title: 'Status',
      position: 'a1',
      settings: statusSettings,
    },
    {
      id: unique('sub_date'),
      type: 'date',
      title: 'Date',
      position: 'a2',
      settings: columnRegistry.defaultSettings('date') as Record<string, unknown>,
    },
  ];
}

/** True for an item that has a parent (subitems are one level deep). */
export function isSubitem(item: Pick<Item, 'parentItemId'>): boolean {
  return item.parentItemId !== null && item.parentItemId !== undefined;
}

/** Subitems grouped by parent id, each list sorted by position (ties by id). */
export function subitemsByParent<
  T extends Pick<Item, 'parentItemId' | 'position'> & { id: string },
>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    if (item.parentItemId === null || item.parentItemId === undefined) continue;
    const list = map.get(item.parentItemId);
    if (list) list.push(item);
    else map.set(item.parentItemId, [item]);
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1,
    );
  }
  return map;
}
