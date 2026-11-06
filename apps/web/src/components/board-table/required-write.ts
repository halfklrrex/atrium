/**
 * The required-columns hard rule on the client (docs/specs/REQ-required-columns-hard-rule.md):
 * a cell write may not leave a required cell empty (rule 1) and may not move a Status into a done
 * label while another required cell is empty (rule 2). The Firestore rules enforce rule 1 and a
 * Function reverts rule 2, but this check runs first so the person gets a clear toast and nothing
 * is sent. Creating an item is exempt and never reaches this module.
 */
import {
  REQUIRED_COLUMN_RULE_CAP,
  findRequiredViolation,
  isColumnValueEmpty,
  type ColumnDef,
  type RequiredWriteViolation,
} from '@atrium/shared';
import type { ItemDoc } from '../../data';

/** A write refused by the required-columns rule; `message` is the toast text. */
export class RequiredWriteError extends Error {
  readonly violation: RequiredWriteViolation;
  constructor(violation: RequiredWriteViolation, message: string) {
    super(message);
    this.name = 'RequiredWriteError';
    this.violation = violation;
  }
}

function titles(columns: readonly ColumnDef[], ids: readonly string[]): string[] {
  return ids.map((id) => columns.find((c) => c.id === id)?.title || 'This column');
}

/** "Owner", "Owner and Due date", "Owner, Due date and Budget". */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Toast text for a refused write. */
export function requiredViolationMessage(
  violation: RequiredWriteViolation,
  columns: readonly ColumnDef[],
): string {
  if (violation.kind === 'cleared') {
    const names = titles(columns, violation.columnIds);
    return names.length === 1 ? `${names[0]} is required` : `${listOf(names)} are required`;
  }
  const [status] = titles(columns, violation.statusColumnIds);
  return `Fill in ${titles(columns, violation.missingColumns).join(', ')} before setting ${status} to Done`;
}

/** The "too many required columns" text (rules only check the first REQUIRED_COLUMN_RULE_CAP). */
export const REQUIRED_CAP_MESSAGE = `A board can have at most ${REQUIRED_COLUMN_RULE_CAP} required columns. Turn Required off on another column first.`;

/**
 * Checks one cell write. Returns a `RequiredWriteError` when it breaks the rule, else `null`.
 * `item` is the item as loaded (its cells before the write); without it rule 2 is skipped (the
 * server-side revert still catches it) but rule 1 needs no history.
 */
export function checkRequiredWrite(
  columns: readonly ColumnDef[],
  columnId: string,
  value: unknown,
  item: Pick<ItemDoc, 'values'> | undefined,
): RequiredWriteError | null {
  if (!columns.some((c) => c.required === true)) return null;
  const before = (item?.values ?? {}) as Record<string, unknown>;
  const after = { ...before };
  if (value === null || value === undefined) delete after[columnId];
  else after[columnId] = value;
  const violation = findRequiredViolation(columns, before, after, { written: [columnId] });
  if (!violation) return null;
  // Without the item, "reaching Done" cannot be told from "already Done": keep only rule 1.
  if (!item && violation.kind !== 'cleared') return null;
  return new RequiredWriteError(violation, requiredViolationMessage(violation, columns));
}

/**
 * Message for a Firestore `permission-denied` on a cell write to a required column (the REQ-1
 * rule), or `null` when the denial is not about the required rule.
 */
export function explainRequiredDenied(
  columns: readonly ColumnDef[],
  requiredColumnIds: readonly string[] | undefined,
  columnId: string,
  value: unknown,
): string | null {
  const col = columns.find((c) => c.id === columnId);
  if (!col || col.required !== true) return null;
  if (isColumnValueEmpty(col.type, value)) return `${col.title || 'This column'} is required`;
  const at = requiredColumnIds?.indexOf(columnId) ?? -1;
  return at >= REQUIRED_COLUMN_RULE_CAP ? REQUIRED_CAP_MESSAGE : null;
}

/** How many of `items` have an empty cell in `column` (for the Required switch's note). */
export function countEmptyCells(
  items: readonly Pick<ItemDoc, 'values'>[],
  column: Pick<ColumnDef, 'id' | 'type'>,
): number {
  return items.filter((i) => isColumnValueEmpty(column.type, i.values?.[column.id])).length;
}

/**
 * Turning Required on for `columnId` would push the board past the rules' cap: the rules refuse
 * writes that touch the 11th or later required column, which would lock it.
 */
export function wouldExceedRequiredCap(
  requiredColumnIds: readonly string[] | undefined,
  columnId: string,
): boolean {
  const ids = requiredColumnIds ?? [];
  if (ids.includes(columnId)) return false;
  return ids.length + 1 > REQUIRED_COLUMN_RULE_CAP;
}

/** The note under the Required switch: how many items are empty today (no rewrite). */
export function requiredEmptyNote(count: number): string | null {
  if (count <= 0) return null;
  const subject = count === 1 ? '1 item is empty' : `${count} items are empty`;
  return `${subject}; they stay as they are but can't be saved empty again`;
}
