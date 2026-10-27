/**
 * Pure view model of the board table: which columns, which groups and which items are shown, in
 * what order. No React and no Firebase, so it is unit tested directly.
 */
import {
  columnRegistry,
  groupItems,
  matchesFilter,
  sortItems,
  type BoardFilterState,
  type ColumnDef,
  type GroupDef,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';
import { comparePositions } from '../../lib/positions';

/** Column ids used for the fixed "Item" column in sort state and keyboard navigation. */
export const NAME_COLUMN = 'name';

/** Column types that have a settings panel in the column menu (labels, unit and decimals). */
export const SETTINGS_TYPES: ReadonlySet<string> = new Set(['status', 'dropdown', 'numbers']);

/** Groups with more rows than this render only the rows near the viewport. */
export const VIRTUALIZE_AFTER = 50;

/** Stable dnd id of a group (item ids are plain Firestore ids). */
export const groupKey = (groupId: string): string => `group:${groupId}`;

export function groupItemCountLabel(count: number): string {
  return count === 0 ? 'No items' : count === 1 ? '1 item' : `${count} items`;
}

/** monday's default widths per column type (P1b spec section 1). */
export const DEFAULT_WIDTHS: Readonly<Record<string, number>> = {
  status: 140,
  people: 140,
  date: 140,
  numbers: 140,
  text: 200,
  long_text: 200,
  link: 200,
  dropdown: 160,
  checkbox: 80,
};
export const FALLBACK_WIDTH = 140;
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 1200;
export const DEFAULT_NAME_WIDTH = 400;
export const MIN_NAME_WIDTH = 240;

/** A board column ready to render: ordered, with validated settings and a resolved width. */
export interface ColumnView {
  def: ColumnDef;
  /** Settings parsed by the registry; the type's defaults when the stored ones are invalid. */
  settings: unknown;
  width: number;
}

export function clampWidth(width: number): number {
  return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(width)));
}

export function columnWidth(def: ColumnDef): number {
  return def.width ?? DEFAULT_WIDTHS[def.type] ?? FALLBACK_WIDTH;
}

/** Columns of a board in display order, with settings validated per type. */
export function buildColumnViews(columns: readonly ColumnDef[]): ColumnView[] {
  return [...columns].sort(comparePositions).flatMap((def) => {
    if (!columnRegistry.has(def.type)) return [];
    const parsed = columnRegistry.parseSettings(def.type, def.settings);
    return [
      {
        def,
        settings: parsed.success ? parsed.data : columnRegistry.defaultSettings(def.type),
        width: columnWidth(def),
      },
    ];
  });
}

/**
 * The `grid-template-columns` value shared by every row: name area, value columns, "+" cell.
 * `add` is the width of the last track as a CSS length (a token reference in the app).
 */
export function gridTemplate(
  nameWidth: number,
  columns: readonly ColumnView[],
  add: string,
): string {
  return [...[nameWidth, ...columns.map((c) => c.width)].map((w) => `${w}px`), add].join(' ');
}

/** Total table width as a CSS length: the fixed columns in px plus the "+" track. */
export function tableWidth(nameWidth: number, columns: readonly ColumnView[], add: string): string {
  const fixed = nameWidth + columns.reduce((sum, c) => sum + c.width, 0);
  return `calc(${fixed}px + ${add})`;
}

export interface GroupModel {
  group: GroupDef;
  /** Items to show, in order (after search and sort). */
  items: ItemDoc[];
  /** Every active item of the group, in position order (what position maths must use). */
  all: ItemDoc[];
  /** True when the group was synthesized for a dynamic view (e.g. group-by column). */
  synthetic?: boolean;
  /**
   * Active subitems by parent id, in position order (every parent of the board, not just this
   * group's). Parents are filtered, sorted and searched; subitems only follow their parent.
   */
  subitemsByParent: ReadonlyMap<string, ItemDoc[]>;
  /** Parents shown only because a subitem matched the search: their block opens by itself. */
  autoExpanded: ReadonlySet<string>;
}

export interface ModelInput {
  groups: readonly GroupDef[];
  items: readonly ItemDoc[];
  columns: readonly ColumnView[];
  /** Subitem columns, so a search also reads subitem cells (names only when omitted). */
  subitemColumns?: readonly ColumnView[];
  /** Case-insensitive search term, already trimmed; empty = no search. */
  search: string;
  /** Local moves not yet confirmed by the server (while dragging and until the write lands). */
  patches?: Readonly<Record<string, MovePatch>>;
  filterState?: BoardFilterState;
  /** Optional lookup mapping user ID to display name for grouped views. */
  userLookup?: (uid: string) => string | undefined;
}

export interface MovePatch {
  groupId: string;
  position?: string;
}

/** Text a search matches against: the name plus every column's text form. */
export function itemSearchText(item: ItemDoc, columns: readonly ColumnView[]): string {
  const parts = [item.name];
  for (const column of columns) {
    // Derived columns store nothing: search what the cell shows (computed value).
    const value = columnRegistry.isDerived(column.def.type)
      ? columnRegistry.computeValue(
          {
            ...column.def,
            settings: (column.settings as Record<string, unknown>) ?? column.def.settings,
          },
          {
            boardId: '',
            item,
            columns: columns.map((c) => c.def),
          },
        )
      : item.values[column.def.id];
    if (value === null || value === undefined) continue;
    const text = columnRegistry.toText(column.def.type, value, column.settings);
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

export function itemMatchesSearch(
  item: ItemDoc,
  columns: readonly ColumnView[],
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return itemSearchText(item, columns).toLowerCase().includes(needle);
}

/** Ids of `ids` plus the ids of their subitems (what archive, delete and move must all touch). */
export function withSubitemIds(
  ids: readonly string[],
  items: readonly Pick<ItemDoc, 'id' | 'parentItemId'>[],
): string[] {
  const wanted = new Set(ids);
  const out = [...ids];
  for (const item of items) {
    if (item.parentItemId && wanted.has(item.parentItemId) && !wanted.has(item.id)) {
      out.push(item.id);
      wanted.add(item.id);
    }
  }
  return out;
}

/**
 * Grid template of a subitem block: its name area is as wide as the parent's (`nameTrack`, a CSS
 * length) minus the indent, then the subitem columns and the "+" cell (`add`).
 */
export function subitemGridTemplate(
  nameTrack: string,
  columns: readonly ColumnView[],
  add: string,
  indent: string,
): string {
  return [`calc(${nameTrack} - ${indent})`, ...columns.map((c) => `${c.width}px`), add].join(' ');
}

/** Total width of a subitem block as a CSS length. */
export function subitemTableWidth(
  nameTrack: string,
  columns: readonly ColumnView[],
  add: string,
  indent: string,
): string {
  const fixed = columns.reduce((sum, c) => sum + c.width, 0);
  return `calc(${nameTrack} - ${indent} + ${fixed}px + ${add})`;
}

/**
 * Groups in position order with their items. Items whose group no longer exists are not shown.
 * With a search term, groups without a match are left out entirely.
 */
export function buildGroupModels(input: ModelInput): GroupModel[] {
  const { groups, items, columns, search, patches, filterState, userLookup } = input;
  const subitemColumns = input.subitemColumns ?? [];
  const resolvedColumnDefs = columns.map((c) => ({
    ...c.def,
    settings: (c.settings as Record<string, unknown>) ?? c.def.settings,
  }));
  const byGroup = new Map<string, ItemDoc[]>();
  const subitemsByParent = new Map<string, ItemDoc[]>();

  for (const item of items) {
    if (item.parentItemId !== null && item.parentItemId !== undefined) {
      const subPatch = patches?.[item.id];
      const shownSub = subPatch?.position ? { ...item, position: subPatch.position } : item;
      const siblings = subitemsByParent.get(item.parentItemId);
      if (siblings) siblings.push(shownSub);
      else subitemsByParent.set(item.parentItemId, [shownSub]);
      continue;
    }
    const patch = patches?.[item.id];
    const shown = patch
      ? { ...item, groupId: patch.groupId, position: patch.position ?? item.position }
      : item;
    const list = byGroup.get(shown.groupId);
    if (list) list.push(shown);
    else byGroup.set(shown.groupId, [shown]);
  }

  for (const list of subitemsByParent.values()) list.sort(comparePositions);

  const searching = search.trim() !== '';
  // A parent also matches when one of its subitems does; those parents open their block by
  // themselves while the search is active.
  const autoExpanded = new Set<string>();
  const subitemMatches = (parentId: string): boolean => {
    if (!searching) return false;
    const found = (subitemsByParent.get(parentId) ?? []).some((sub) =>
      itemMatchesSearch(sub, subitemColumns, search),
    );
    if (found) autoExpanded.add(parentId);
    return found;
  };
  const parentMatchesSearch = (item: ItemDoc): boolean =>
    itemMatchesSearch(item, columns, search) || subitemMatches(item.id);

  // Dynamic Group By
  if (filterState?.groupByColumnId) {
    const colDef = resolvedColumnDefs.find((c) => c.id === filterState.groupByColumnId);
    if (colDef) {
      const allItems: ItemDoc[] = [];
      for (const item of items) {
        if (item.parentItemId !== null && item.parentItemId !== undefined) continue;
        const patch = patches?.[item.id];
        allItems.push(
          patch
            ? { ...item, groupId: patch.groupId, position: patch.position ?? item.position }
            : item,
        );
      }

      let filtered = allItems;
      if (searching) {
        filtered = filtered.filter(parentMatchesSearch);
      }
      filtered = filtered.filter((item) =>
        matchesFilter(
          item,
          filterState.filterGroup,
          null,
          filterState.personIds,
          resolvedColumnDefs,
        ),
      );

      const grouped = groupItems(
        filtered,
        filterState.groupByColumnId,
        colDef,
        undefined,
        userLookup,
      );
      const models: GroupModel[] = [];

      for (const grp of grouped) {
        let shown = grp.items as ItemDoc[];
        if (filterState.sortConditions.length > 0) {
          shown = sortItems(shown, filterState.sortConditions, resolvedColumnDefs) as ItemDoc[];
        }
        models.push({
          group: {
            id: grp.groupId,
            title: grp.groupTitle,
            color: grp.groupColor ?? '#579bfc',
            position: 'a0',
          },
          items: shown,
          all: shown,
          synthetic: true,
          subitemsByParent,
          autoExpanded,
        });
      }
      return models;
    }
  }

  const models: GroupModel[] = [];
  const hasFiltering =
    searching ||
    (filterState &&
      (filterState.personIds.length > 0 || filterState.filterGroup.conditions.length > 0));

  for (const group of [...groups].sort(comparePositions)) {
    const all = (byGroup.get(group.id) ?? []).sort(comparePositions);
    let shown = all;
    if (searching) {
      shown = shown.filter(parentMatchesSearch);
    }
    if (filterState) {
      shown = shown.filter((item) =>
        matchesFilter(
          item,
          filterState.filterGroup,
          null,
          filterState.personIds,
          resolvedColumnDefs,
        ),
      );
    }
    if (filterState && filterState.sortConditions.length > 0) {
      shown = sortItems(shown, filterState.sortConditions, resolvedColumnDefs) as ItemDoc[];
    }
    if (hasFiltering && shown.length === 0) continue;
    models.push({ group, items: shown, all, subitemsByParent, autoExpanded });
  }
  return models;
}
