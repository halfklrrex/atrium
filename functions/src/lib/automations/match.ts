import type { AutomationCondition, AutomationTrigger } from '@atrium/shared';

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
  data?: { toValue?: unknown; depth?: number } | undefined;
}

export interface MatchItem {
  values: Record<string, unknown>;
}

/** The activity kinds that can start a recipe today. */
export const TRIGGER_KINDS = ['item_created', 'value_changed', 'button_clicked'] as const;

/** A status value is `{ index }`; returns the index, or `null` for anything else. */
export function statusIndexOf(value: unknown): number | null {
  const index = (value as { index?: unknown } | null | undefined)?.index;
  return typeof index === 'number' && Number.isInteger(index) ? index : null;
}

/**
 * True when `entry` starts `automation`. `status_changed` compares `toLabelId` (a status label
 * index) with the entry's new value, falling back to the item's current value when the entry did
 * not keep the raw value. Subitem entries never match.
 */
export function matchAutomation(
  automation: { trigger: AutomationTrigger },
  entry: MatchEntry,
  item?: MatchItem | null,
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
      return statusIndexOf(to) === trigger.toLabelId;
    }
    case 'button_clicked':
      return entry.kind === 'button_clicked' && entry.columnId === trigger.columnId;
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
export function valuesEqual(stored: unknown, wanted: unknown): boolean {
  const a = statusIndexOf(stored);
  const b = statusIndexOf(wanted);
  if (a !== null && b !== null) return a === b;
  if (a !== null && typeof wanted === 'number') return a === wanted;
  if (b !== null && typeof stored === 'number') return b === stored;
  return canonical(stored) === canonical(wanted);
}

export function conditionHolds(condition: AutomationCondition, item: MatchItem): boolean {
  const stored = item.values[condition.columnId];
  switch (condition.op) {
    case 'is_empty':
      return isEmptyValue(stored);
    case 'is_not_empty':
      return !isEmptyValue(stored);
    case 'is':
      return valuesEqual(stored, condition.value);
    case 'is_not':
      return !valuesEqual(stored, condition.value);
  }
}

/** All conditions hold (an empty list holds). */
export const conditionsHold = (
  conditions: readonly AutomationCondition[],
  item: MatchItem,
): boolean => conditions.every((c) => conditionHolds(c, item));
