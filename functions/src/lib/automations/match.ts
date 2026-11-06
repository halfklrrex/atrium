import {
  findStatusLabel,
  peopleValueSchema,
  type AutomationCondition,
  type AutomationTrigger,
  type StatusSettings,
  type StatusValue,
} from '@atrium/shared';

/**
 * Pure matching for the automation runner (P5a): does an activity entry start a recipe, and does an
 * item pass a recipe's conditions. No reads, no writes.
 */

/** The slice of an activity entry the matcher reads. */
export interface MatchEntry {
  kind: string;
  itemId: string | null;
  parentItemId?: string | null;
  columnId: string | null;
  groupId: string | null;
  data?:
    { fromValue?: unknown; toValue?: unknown; fromGroupId?: string; depth?: number } | undefined;
}

export interface MatchItem {
  values: Record<string, unknown>;
}

/** The slice of a board column the matcher reads: a status column's labels live in `settings`. */
export interface MatchColumn {
  id: string;
  settings?: unknown;
}

/** The activity kinds that can start a recipe today. */
export const TRIGGER_KINDS = [
  'item_created',
  'item_moved',
  'value_changed',
  'button_clicked',
] as const;

const isStatusSettings = (settings: unknown): settings is StatusSettings =>
  Array.isArray((settings as { labels?: unknown } | null | undefined)?.labels);

/**
 * The label index of a status value: `{ index }`, or `{ label }` text resolved through the column's
 * `settings` (`findStatusLabel`, as the cell itself is read). `null` for anything else.
 */
export function statusIndexOf(value: unknown, settings?: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const { index, label } = value as { index?: unknown; label?: unknown };
  const hasIndex = typeof index === 'number' && Number.isInteger(index);
  if (isStatusSettings(settings) && (hasIndex || typeof label === 'string')) {
    const found = findStatusLabel(value as StatusValue, settings);
    if (found) return found.index;
  }
  return hasIndex ? index : null;
}

/** The uids of the `person` entries (not teams) of a People cell value; `[]` for anything else. */
export function personUidsOf(value: unknown): string[] {
  const parsed = peopleValueSchema.safeParse(value);
  return parsed.success
    ? parsed.data.personsAndTeams.filter((p) => p.kind === 'person').map((p) => p.id)
    : [];
}

/**
 * True when `entry` starts `automation`. `status_changed` compares `toLabelId` (a status label
 * index) with the entry's new value, falling back to the item's current value when the entry did
 * not keep the raw value; a label-only value (`{ label }`) is resolved through the column's settings
 * in `columns`. Subitem entries never match.
 */
export function matchAutomation(
  automation: { trigger: AutomationTrigger },
  entry: MatchEntry,
  item?: MatchItem | null,
  columns?: readonly MatchColumn[],
): boolean {
  if (!entry.itemId || entry.parentItemId) return false;
  const { trigger } = automation;
  switch (trigger.type) {
    case 'item_created':
      return (
        entry.kind === 'item_created' &&
        (trigger.groupId === undefined || trigger.groupId === entry.groupId)
      );
    case 'status_changed': {
      if (entry.kind !== 'value_changed' || entry.columnId !== trigger.columnId) return false;
      if (trigger.toLabelId === undefined) return true;
      const to =
        entry.data?.toValue !== undefined ? entry.data.toValue : item?.values[trigger.columnId];
      const settings = columns?.find((c) => c.id === trigger.columnId)?.settings;
      return statusIndexOf(to, settings) === trigger.toLabelId;
    }
    case 'button_clicked':
      return entry.kind === 'button_clicked' && entry.columnId === trigger.columnId;
    case 'item_moved':
      return (
        entry.kind === 'item_moved' &&
        (trigger.groupId === undefined || trigger.groupId === entry.groupId)
      );
    case 'person_assigned': {
      if (entry.kind !== 'value_changed' || entry.columnId !== trigger.columnId) return false;
      // The activity entry keeps the raw values only when they fit `ACTIVITY_LIMITS.rawBytes`.
      // `fromValue: null` is a kept, empty cell; a missing key was dropped. The new value falls
      // back to the item's current one. When "from" is unknown the change cannot be decided: a
      // missed run is better than a wrong one, so it does not match.
      const to =
        entry.data?.toValue !== undefined ? entry.data.toValue : item?.values[trigger.columnId];
      if (entry.data?.fromValue === undefined || to === undefined) return false;
      const before = new Set(personUidsOf(entry.data.fromValue));
      const added = personUidsOf(to).filter((uid) => !before.has(uid));
      return trigger.uid === undefined ? added.length > 0 : added.includes(trigger.uid);
    }
    case 'date_arrives':
    case 'recurring':
      // Scheduler-driven (P5d), never an item event.
      return false;
  }
}

/** Key-order independent JSON, so `{a:1,b:2}` equals `{b:2,a:1}`. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** An empty cell: nothing stored, an empty string or list, or a people / dropdown value with nobody. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const v = value as { personsAndTeams?: unknown; ids?: unknown };
    if (Array.isArray(v.personsAndTeams)) return v.personsAndTeams.length === 0;
    if (Array.isArray(v.ids)) return v.ids.length === 0;
  }
  return false;
}

/** Cell equality for `is`: a status index number equals a `{ index }` value; otherwise JSON equality. */
export function valuesEqual(stored: unknown, wanted: unknown, settings?: unknown): boolean {
  const a = statusIndexOf(stored, settings);
  const b = statusIndexOf(wanted, settings);
  if (a !== null && b !== null) return a === b;
  if (a !== null && typeof wanted === 'number') return a === wanted;
  if (b !== null && typeof stored === 'number') return b === stored;
  return canonical(stored) === canonical(wanted);
}

export function conditionHolds(
  condition: AutomationCondition,
  item: MatchItem,
  columns?: readonly MatchColumn[],
): boolean {
  const stored = item.values[condition.columnId];
  const settings = columns?.find((c) => c.id === condition.columnId)?.settings;
  switch (condition.op) {
    case 'is_empty':
      return isEmptyValue(stored);
    case 'is_not_empty':
      return !isEmptyValue(stored);
    case 'is':
      return valuesEqual(stored, condition.value, settings);
    case 'is_not':
      return !valuesEqual(stored, condition.value, settings);
  }
}

/** All conditions hold (an empty list holds). */
export const conditionsHold = (
  conditions: readonly AutomationCondition[],
  item: MatchItem,
  columns?: readonly MatchColumn[],
): boolean => conditions.every((c) => conditionHolds(c, item, columns));
