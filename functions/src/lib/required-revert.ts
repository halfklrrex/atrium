import { findRequiredViolation, type ColumnDef } from '@atrium/shared';
import { actorOf, activityDoc, sameJson, valueText, type NewActivity } from './activity';

/**
 * REQ-2 (docs/specs/REQ-required-columns-hard-rule.md, rule 2). Firestore rules can't read an
 * item's other cells, so a write that moves a Status into a done label while a required cell is
 * empty is committed and then put back here, with an activity entry saying why. The revert is
 * eventual, not atomic (owner decision, 2026-11-06). The trigger body takes an injected store so it
 * can be unit-tested.
 */

/** The actor of the revert's activity entry. */
export const REQUIRED_REVERT_ACTOR_ID = 'system:required-columns';
const REQUIRED_REVERT_ACTOR_NAME = 'Atrium';

/** The slice of a board the revert reads. */
export interface RequiredRevertBoard {
  columns: ReadonlyArray<ColumnDef>;
  subitemColumns?: ReadonlyArray<ColumnDef>;
  requiredColumnIds?: readonly string[] | null;
}

export interface RequiredRevertPlan {
  /** The status columns to restore: the value that was just written and the one to put back. */
  restore: Array<{ columnId: string; written: unknown; previous: unknown }>;
  entry: NewActivity;
}

/** What the store hands `decide`: the item's current state. */
export interface RequiredRevertItem {
  state?: unknown;
  values: Record<string, unknown>;
}

export interface RequiredRevertStore {
  /** `null` when the board no longer exists. */
  getBoard(boardId: string): Promise<RequiredRevertBoard | null>;
  /**
   * Runs `decide` on the item's *current* data inside a transaction and applies the plan it
   * returns (restore each `columnId` to `previous`, where `undefined` deletes the cell; create the
   * entry). `null` means no write. Resolves to the plan that was applied, or `null`.
   */
  revert(
    boardId: string,
    itemId: string,
    entryId: string,
    decide: (current: RequiredRevertItem) => RequiredRevertPlan | null,
  ): Promise<RequiredRevertPlan | null>;
}

export interface RequiredRevertEvent {
  eventId: string;
  boardId: string;
  itemId: string;
  /** The item before and after the write; `before` is missing on create (creates are exempt). */
  before?: { values?: Record<string, unknown>; parentItemId?: unknown } | undefined;
  after: {
    name?: unknown;
    values?: Record<string, unknown>;
    parentItemId?: unknown;
    state?: unknown;
  };
}

export type RequiredRevertOutcome =
  | { reverted: false; reason: 'create' | 'no-required' | 'allowed' | 'gone' | 'superseded' }
  | { reverted: true; columnIds: string[] };

/**
 * Trigger body. Does nothing for creates, boards without `requiredColumnIds`, writes that did not
 * move a Status into a done label, and writes where every other required cell is filled. Loop
 * safety: the revert itself moves a Status *out of* done, which is not a move into done, so its own
 * event is a no-op here (and it is checked again against the current item before writing).
 */
export async function revertDoneWithEmptyRequired(
  store: RequiredRevertStore,
  event: RequiredRevertEvent,
): Promise<RequiredRevertOutcome> {
  if (!event.before) return { reverted: false, reason: 'create' };
  const board = await store.getBoard(event.boardId);
  if (!board) return { reverted: false, reason: 'gone' };
  if (!board.requiredColumnIds || board.requiredColumnIds.length === 0) {
    return { reverted: false, reason: 'no-required' };
  }
  const columns = (event.after.parentItemId ? board.subitemColumns : board.columns) ?? [];
  const beforeValues = event.before.values ?? {};
  const afterValues = event.after.values ?? {};
  if (!findRequiredViolation(columns, beforeValues, afterValues)) {
    return { reverted: false, reason: 'allowed' };
  }

  const decide = (current: RequiredRevertItem): RequiredRevertPlan | null => {
    // The item may have changed since the event: judge the current state, and only touch cells
    // that still hold what was just written (a newer write is never clobbered).
    if (current.state !== undefined && current.state !== 'active') return null;
    const violation = findRequiredViolation(columns, beforeValues, current.values);
    if (violation?.kind !== 'done_with_empty') return null;
    const restore = violation.statusColumnIds
      .filter((id) => sameJson(current.values[id] ?? null, afterValues[id] ?? null))
      .map((columnId) => ({
        columnId,
        written: current.values[columnId],
        previous: beforeValues[columnId],
      }));
    if (restore.length === 0) return null;
    const status = columns.find((c) => c.id === restore[0]!.columnId)!;
    const titles = violation.missingColumns.map(
      (id) => columns.find((c) => c.id === id)?.title ?? id,
    );
    const noProfiles = new Map();
    const entry = activityDoc(
      actorOf(REQUIRED_REVERT_ACTOR_ID, { name: REQUIRED_REVERT_ACTOR_NAME, photoURL: null }),
      'required_reverted',
      {
        itemId: event.itemId,
        itemName: typeof event.after.name === 'string' ? event.after.name : '',
        parentItemId:
          typeof event.after.parentItemId === 'string' ? event.after.parentItemId : null,
        columnId: status.id,
        columnTitle: status.title,
        columnType: status.type,
        data: {
          fromText: valueText(status.type, restore[0]!.written, status.settings, noProfiles),
          toText: valueText(status.type, restore[0]!.previous, status.settings, noProfiles),
          missingTitles: titles.slice(0, 10),
        },
      },
    );
    return { restore, entry };
  };

  const applied = await store.revert(
    event.boardId,
    event.itemId,
    `${event.eventId}-required`,
    decide,
  );
  if (!applied) return { reverted: false, reason: 'superseded' };
  return { reverted: true, columnIds: applied.restore.map((r) => r.columnId) };
}
