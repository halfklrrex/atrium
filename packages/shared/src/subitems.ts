import type { ColumnDef } from './schemas/board';
import type { Item } from './schemas/item';
import { columnRegistry } from './columns';
import type { StatusSettings } from './columns';
import { DEFAULT_BOARD_STATUS_LABELS } from './boards';

/**
 * @deprecated Subitems share the board's columns; only tests and the legacy create path use this.
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

/**
 * The columns an item's cells use. Subitems share the board's columns (SUBITEMS-as-items).
 * Transition only: a board that still has legacy `subitemColumns` (not migrated yet) keeps them
 * for its subitems. PR 6 removes the fallback.
 */
export function columnsForItem<C>(
  board: { columns: readonly C[]; subitemColumns?: readonly C[] | null },
  item: { parentItemId?: string | null },
): readonly C[] {
  if (
    isSubitem({ parentItemId: item.parentItemId ?? null }) &&
    (board.subitemColumns?.length ?? 0) > 0
  ) {
    return board.subitemColumns as readonly C[];
  }
  return board.columns;
}

// ---------------------------------------------------------------------------------------------
// Migration plan: merge the legacy subitem columns into the board's columns
// ---------------------------------------------------------------------------------------------

/** Column types whose subitem column may merge into a board column with the same title. */
export const SUBITEM_MERGE_TYPES: readonly string[] = [
  'status',
  'dropdown',
  'people',
  'date',
  'text',
  'long_text',
  'numbers',
  'checkbox',
  'link',
  'email',
  'phone',
  'rating',
  'timeline',
];

/** The subitem fields the planner reads. */
export interface SubitemForPlan {
  id: string;
  values: Record<string, unknown>;
}

export type SubitemColumnAction = 'merge' | 'move' | 'drop';

export interface SubitemColumnDecision {
  columnId: string;
  title: string;
  type: string;
  action: SubitemColumnAction;
  /** Merge: the board column that receives the values. */
  targetId?: string;
  targetTitle?: string;
  /** Subitems with a non-empty value in this column. */
  filledCount: number;
  /** Merge: labels appended to the target (status and dropdown). */
  addedLabels: string[];
  /** Move: the title the column gets on the board. */
  movedTitle?: string;
  note?: string;
}

/** Field-path writes for one subitem: `values.<id>` set and `values.<id>` removed. */
export interface SubitemValueWrite {
  itemId: string;
  set: Record<string, unknown>;
  /** Ids of the legacy columns whose stored value goes away (merged, dropped). */
  remove: string[];
}

export interface SubitemMergePlan {
  decisions: SubitemColumnDecision[];
  /** The board's new `columns` (labels added to merge targets, moved columns appended). */
  columns: ColumnDef[];
  /** The new `columnLocks` (a merged lock moves to its target, a dropped one goes away). */
  columnLocks: string[];
  /** Copies into merge targets, written before the board drops `subitemColumns`. */
  copies: SubitemValueWrite[];
  /** Removals of legacy values, written after. Never includes a value that was not copied or dropped. */
  removals: SubitemValueWrite[];
  /** Values that could not move cleanly (target already filled, unknown label). Kept in the item. */
  conflicts: string[];
  /** Reasons this board cannot be planned; the board is skipped when there is one. */
  problems: string[];
}

/** Deep copy of plain JSON data (this package has no `structuredClone` typing). */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const normTitle = (title: string): string => title.trim().toLowerCase();

/** Missing, null, `''`, `[]` and `{}` count as empty (REQ semantics). */
export function isEmptyCellValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

interface StatusLabelLike {
  id: string;
  index: number;
  label: string;
  color: string;
  isDone?: boolean;
}

interface DropdownLabelLike {
  id: number;
  label: string;
}

const labelsOf = <L>(column: ColumnDef): L[] => {
  const labels = (column.settings as { labels?: unknown }).labels;
  return Array.isArray(labels) ? (labels as L[]) : [];
};

/** The text of a subitem status value, or `null` when it is empty or points at no label. */
function statusText(value: unknown, column: ColumnDef): string | null | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { index, label } = value as { index?: unknown; label?: unknown };
  const labels = labelsOf<StatusLabelLike>(column);
  let found: StatusLabelLike | undefined;
  if (typeof index === 'number') found = labels.find((l) => l.index === index);
  if (!found && typeof label === 'string') {
    const wanted = normTitle(label);
    found = labels.find((l) => normTitle(l.label) === wanted);
    if (!found) return wanted === '' ? null : undefined;
  }
  if (!found) return undefined;
  return found.label.trim() === '' ? null : found.label;
}

/** Slug for a new status label id. */
const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'label';

/**
 * Decides, per legacy subitem column, whether it merges into a board column, moves into the board's
 * columns or is dropped, and works out the writes (SUBITEMS-as-items, owner question 2). Pure: it
 * returns the plan and never touches Firestore. `subitems` must hold the subitems in every state.
 * A board with no `subitemColumns` yields an empty plan, so a rerun is a no-op.
 */
export function planSubitemColumnMerge(
  columns: readonly ColumnDef[],
  subitemColumns: readonly ColumnDef[],
  subitems: readonly SubitemForPlan[],
  columnLocks: readonly string[] = [],
): SubitemMergePlan {
  const plan: SubitemMergePlan = {
    decisions: [],
    columns: columns.map((c) => clone(c)),
    columnLocks: [...columnLocks],
    copies: [],
    removals: [],
    conflicts: [],
    problems: [],
  };
  if (subitemColumns.length === 0) return plan;

  for (const c of [...columns, ...subitemColumns]) {
    if (c.migrating) plan.problems.push(`column "${c.title}" (${c.id}) has a type change running`);
  }
  const boardIds = new Set(columns.map((c) => c.id));
  const usedTargets = new Set<string>();
  const usedTitles = new Set(columns.map((c) => normTitle(c.title)));
  let lastPosition =
    [...columns]
      .map((c) => c.position)
      .sort()
      .at(-1) ?? 'a0';
  const lockSet = new Set(columnLocks);
  const copies = new Map<string, SubitemValueWrite>();
  const removals = new Map<string, SubitemValueWrite>();
  const writeFor = (map: Map<string, SubitemValueWrite>, itemId: string): SubitemValueWrite => {
    let write = map.get(itemId);
    if (!write) {
      write = { itemId, set: {}, remove: [] };
      map.set(itemId, write);
    }
    return write;
  };

  for (const S of subitemColumns) {
    const filled = subitems.filter((s) => !isEmptyCellValue(s.values[S.id]));
    const target = SUBITEM_MERGE_TYPES.includes(S.type)
      ? plan.columns.find(
          (c) =>
            boardIds.has(c.id) &&
            !usedTargets.has(c.id) &&
            c.type === S.type &&
            normTitle(c.title) === normTitle(S.title),
        )
      : undefined;
    const decision: SubitemColumnDecision = {
      columnId: S.id,
      title: S.title,
      type: S.type,
      action: 'drop',
      filledCount: filled.length,
      addedLabels: [],
    };

    if (target) {
      usedTargets.add(target.id);
      decision.action = 'merge';
      decision.targetId = target.id;
      decision.targetTitle = target.title;
      if (lockSet.delete(S.id)) lockSet.add(target.id);
      mergeColumn(S, target, subitems, decision, plan, copies, removals, writeFor);
    } else if (filled.length > 0) {
      decision.action = 'move';
      if (boardIds.has(S.id)) {
        plan.problems.push(`subitem column id "${S.id}" already exists in the board's columns`);
      }
      let title = S.title;
      if (usedTitles.has(normTitle(title))) title = `${title} (subitems)`.slice(0, 120);
      usedTitles.add(normTitle(title));
      decision.movedTitle = title;
      lastPosition = `${lastPosition}V`;
      const { required: _required, migrating: _m, lastTypeChange: _l, ...rest } = S;
      void _required;
      void _m;
      void _l;
      plan.columns.push({ ...clone(rest), title, position: lastPosition });
      if (S.required)
        decision.note = 'the "required" flag is cleared so parent items are not blocked';
    } else {
      lockSet.delete(S.id);
      if (columnRegistryIsDerived(S.type)) {
        decision.note = 'a computed column: its definition is discarded';
      }
      for (const s of subitems) {
        if (Object.prototype.hasOwnProperty.call(s.values, S.id)) {
          writeFor(removals, s.id).remove.push(S.id);
        }
      }
    }
    plan.decisions.push(decision);
  }

  plan.columnLocks = [...lockSet];
  plan.copies = [...copies.values()];
  plan.removals = [...removals.values()];
  return plan;
}

function columnRegistryIsDerived(type: string): boolean {
  return columnRegistry.has(type) && columnRegistry.isDerived(type);
}

function mergeColumn(
  S: ColumnDef,
  target: ColumnDef,
  subitems: readonly SubitemForPlan[],
  decision: SubitemColumnDecision,
  plan: SubitemMergePlan,
  copies: Map<string, SubitemValueWrite>,
  removals: Map<string, SubitemValueWrite>,
  writeFor: (map: Map<string, SubitemValueWrite>, itemId: string) => SubitemValueWrite,
): void {
  // Label bookkeeping: the target's labels may grow while values are mapped.
  const statusLabels =
    S.type === 'status' ? (labelsOf<StatusLabelLike>(target) as StatusLabelLike[]) : [];
  const dropdownLabels =
    S.type === 'dropdown' ? (labelsOf<DropdownLabelLike>(target) as DropdownLabelLike[]) : [];

  const statusIndexFor = (text: string, from: StatusLabelLike | undefined): number => {
    const wanted = normTitle(text);
    const existing = statusLabels.find((l) => normTitle(l.label) === wanted);
    if (existing) return existing.index;
    const index = statusLabels.reduce((max, l) => Math.max(max, l.index), -1) + 1;
    const ids = new Set(statusLabels.map((l) => l.id));
    let id = `${slug(text)}_${index}`;
    for (let n = 2; ids.has(id); n += 1) id = `${slug(text)}_${index}_${n}`;
    const label: StatusLabelLike = {
      id,
      index,
      label: text,
      color: from?.color ?? '#c4c4c4',
      ...(from?.isDone ? { isDone: true } : {}),
    };
    statusLabels.push(label);
    decision.addedLabels.push(text);
    return index;
  };
  const dropdownIdFor = (text: string): number => {
    const wanted = normTitle(text);
    const existing = dropdownLabels.find((l) => normTitle(l.label) === wanted);
    if (existing) return existing.id;
    const id = dropdownLabels.reduce((max, l) => Math.max(max, l.id), -1) + 1;
    dropdownLabels.push({ id, label: text });
    decision.addedLabels.push(text);
    return id;
  };

  const sourceStatus = labelsOf<StatusLabelLike>(S);
  const sourceDropdown = labelsOf<DropdownLabelLike>(S);

  for (const sub of subitems) {
    const raw = sub.values[S.id];
    const has = Object.prototype.hasOwnProperty.call(sub.values, S.id);
    if (!has) continue;
    const label = `${sub.id}: "${S.title}"`;
    if (isEmptyCellValue(raw)) {
      writeFor(removals, sub.id).remove.push(S.id);
      continue;
    }
    if (!isEmptyCellValue(sub.values[target.id])) {
      plan.conflicts.push(`${label} kept: the item already has a value in "${target.title}"`);
      continue;
    }
    let mapped: unknown = raw;
    if (S.type === 'status') {
      const text = statusText(raw, S);
      if (text === null) {
        // A blank label means "no status": nothing to copy.
        writeFor(removals, sub.id).remove.push(S.id);
        continue;
      }
      if (text === undefined) {
        plan.conflicts.push(`${label} kept: its status points at no label`);
        continue;
      }
      const from = sourceStatus.find((l) => normTitle(l.label) === normTitle(text));
      mapped = { index: statusIndexFor(text, from) };
    } else if (S.type === 'dropdown') {
      const ids = (raw as { ids?: unknown }).ids;
      if (!Array.isArray(ids)) {
        plan.conflicts.push(`${label} kept: not a dropdown value`);
        continue;
      }
      const texts = ids.map((id) => sourceDropdown.find((l) => l.id === id)?.label);
      if (texts.some((t) => t === undefined)) {
        plan.conflicts.push(`${label} kept: its dropdown value points at no label`);
        continue;
      }
      mapped = { ids: [...new Set((texts as string[]).map(dropdownIdFor))] };
    }
    writeFor(copies, sub.id).set[target.id] = clone(mapped);
    writeFor(removals, sub.id).remove.push(S.id);
  }

  if (decision.addedLabels.length > 0) {
    const index = plan.columns.findIndex((c) => c.id === target.id);
    const current = plan.columns[index]!;
    plan.columns[index] = {
      ...current,
      settings: {
        ...current.settings,
        labels: S.type === 'status' ? statusLabels : dropdownLabels,
      },
    };
  }
}
