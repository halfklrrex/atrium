/**
 * Pure model of the Kanban view: which status column makes the lanes, which cards each lane shows
 * and in what order, which columns a card shows, and where a dropped card goes. No React and no
 * Firebase, so it is unit tested directly.
 */
import {
  KANBAN_DEFAULT_CARD_COLUMNS,
  KANBAN_EMPTY_LANE,
  columnRegistry,
  findStatusLabel,
  matchesFilter,
  sortItems,
  type BoardFilterState,
  type KanbanSettings,
  type StatusLabel,
  type StatusSettings,
  type StatusValue,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';
import { comparePositions, positionAtIndex } from '../../lib/positions';
import { itemMatchesSearch, type ColumnView } from '../board-table/table-model';

/** One lane: a status label (or the "Empty" lane) with its cards. */
export interface KanbanLane {
  /** The label id, or `KANBAN_EMPTY_LANE`. */
  key: string;
  title: string;
  /** The label's colour; `null` for the Empty lane (it uses the grey token). */
  color: string | null;
  /** The status value a card dropped here gets (`null` clears it). */
  value: StatusValue | null;
  /** Cards shown (after search, filters and sort), in order. */
  items: ItemDoc[];
  /** Every card of the lane, whatever the filters hide. */
  all: ItemDoc[];
  collapsed: boolean;
}

/** A card that was just dropped and whose write has not landed yet. */
export interface KanbanPatch {
  value: StatusValue | null;
  position: string;
}

export const EMPTY_LANE_TITLE = 'Empty';

/** The status column that makes the lanes: the saved one if it still exists, else the first. */
export function resolveStatusColumn(
  columns: readonly ColumnView[],
  columnId: string | null,
): ColumnView | null {
  const statuses = columns.filter((c) => c.def.type === 'status');
  return statuses.find((c) => c.def.id === columnId) ?? statuses[0] ?? null;
}

/** The columns a card shows when the view has not chosen any: the first three plain ones. */
export function defaultCardColumns(
  columns: readonly ColumnView[],
  statusColumnId: string | null,
): ColumnView[] {
  return columns
    .filter(
      (c) =>
        c.def.type !== 'status' &&
        c.def.id !== statusColumnId &&
        !columnRegistry.isDerived(c.def.type),
    )
    .slice(0, KANBAN_DEFAULT_CARD_COLUMNS);
}

/** The columns a card shows, in the view's order (ids of deleted columns are skipped). */
export function resolveCardColumns(
  columns: readonly ColumnView[],
  kanban: Pick<KanbanSettings, 'cardColumnIds'>,
  statusColumnId: string | null,
): ColumnView[] {
  if (kanban.cardColumnIds === null) return defaultCardColumns(columns, statusColumnId);
  return kanban.cardColumnIds.flatMap((id) => {
    const column = columns.find((c) => c.def.id === id);
    return column ? [column] : [];
  });
}

/** The status label a card holds; blank labels (monday's grey "no status") count as none. */
export function cardLabel(item: ItemDoc, status: ColumnView): StatusLabel | null {
  const raw = item.values[status.def.id];
  if (raw === null || raw === undefined) return null;
  const parsed = columnRegistry.parseValue('status', raw);
  if (!parsed.success) return null;
  const label = findStatusLabel(parsed.data as StatusValue, status.settings as StatusSettings);
  return label && label.label.trim() !== '' ? label : null;
}

export interface BuildLanesInput {
  items: readonly ItemDoc[];
  status: ColumnView;
  /** Every board column (filters and search read all of them, shown or not). */
  columns: readonly ColumnView[];
  filterState?: BoardFilterState;
  /** Trimmed, case-insensitive search term; empty = none. */
  search: string;
  patches?: Readonly<Record<string, KanbanPatch>>;
  kanban: Pick<KanbanSettings, 'collapsedLaneIds' | 'showEmptyLanes'>;
}

/**
 * The lanes, in the order of the status labels, with the Empty lane last. Subitems are not cards.
 * Cards inside a lane follow their `position` (or the view's sort when one is active).
 */
export function buildKanbanLanes(input: BuildLanesInput): KanbanLane[] {
  const { status, columns, filterState, search, patches, kanban } = input;
  const settings = status.settings as StatusSettings;
  const defs = columns.map((c) => ({
    ...c.def,
    settings: (c.settings as Record<string, unknown>) ?? c.def.settings,
  }));

  const labels = settings.labels.filter((l) => l.label.trim() !== '');
  const lanes = new Map<string, KanbanLane>();
  for (const label of labels) {
    lanes.set(label.id, {
      key: label.id,
      title: label.label,
      color: label.color,
      value: { index: label.index },
      items: [],
      all: [],
      collapsed: kanban.collapsedLaneIds.includes(label.id),
    });
  }
  const empty: KanbanLane = {
    key: KANBAN_EMPTY_LANE,
    title: EMPTY_LANE_TITLE,
    color: null,
    value: null,
    items: [],
    all: [],
    collapsed: kanban.collapsedLaneIds.includes(KANBAN_EMPTY_LANE),
  };

  const needle = search.trim();

  for (const original of input.items) {
    if (original.parentItemId !== null && original.parentItemId !== undefined) continue;
    const patch = patches?.[original.id];
    const item: ItemDoc = patch
      ? {
          ...original,
          position: patch.position,
          values: withStatus(original.values, status.def.id, patch.value),
        }
      : original;
    const label = cardLabel(item, status);
    const lane = (label && lanes.get(label.id)) || empty;
    lane.all.push(item);
    if (needle && !itemMatchesSearch(item, columns, needle)) continue;
    if (
      filterState &&
      !matchesFilter(item, filterState.filterGroup, null, filterState.personIds, defs)
    ) {
      continue;
    }
    lane.items.push(item);
  }

  const out = [...lanes.values(), empty];
  for (const lane of out) {
    lane.all.sort(comparePositions);
    lane.items.sort(comparePositions);
    if (filterState && filterState.sortConditions.length > 0) {
      lane.items = sortItems(lane.items, filterState.sortConditions, defs) as ItemDoc[];
    }
  }
  return out.filter((lane) => kanban.showEmptyLanes || lane.all.length > 0);
}

function withStatus(
  values: Record<string, unknown>,
  columnId: string,
  value: StatusValue | null,
): Record<string, unknown> {
  const { [columnId]: _old, ...rest } = values;
  return value === null ? rest : { ...rest, [columnId]: value };
}

/** Whether the view orders cards itself (a sort is active), which turns dragging off. */
export function isSorted(filterState: BoardFilterState | undefined): boolean {
  return (filterState?.sortConditions.length ?? 0) > 0;
}

export interface DropPlan {
  /** The status value to write, or `undefined` when the card stays in its lane. */
  value: StatusValue | null | undefined;
  /** The card's new position key. */
  position: string;
}

/**
 * Where a card dropped at `index` goes. `index` counts the target lane's shown cards without the
 * dragged one. Returns `null` when nothing would change (same lane, same place).
 */
export function planDrop(input: {
  item: ItemDoc;
  from: KanbanLane;
  to: KanbanLane;
  index: number;
}): DropPlan | null {
  const { item, from, to, index } = input;
  const sameLane = from.key === to.key;
  if (sameLane && to.items.findIndex((i) => i.id === item.id) === index) return null;
  const others = to.items.filter((i) => i.id !== item.id);
  const position = positionAtIndex(others, index);
  return { value: sameLane ? undefined : to.value, position };
}

/** Whether a cell value has nothing to show (such a field row is left out of the card). */
export function isEmptyFieldValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

/** Lanes with more cards than this render only the cards near the viewport. */
export const KANBAN_VIRTUALIZE_AFTER = 100;

/** Stable dnd id of a lane (item ids are plain Firestore ids). */
export const laneDropId = (key: string): string => `lane:${key}`;
