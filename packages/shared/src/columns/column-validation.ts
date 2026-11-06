import type { BoardRole } from '../roles';
import type { ColumnDef, ColumnDefInput } from '../schemas/board';
import {
  BUTTON_ACTION_LABELS,
  BUTTON_LIMITS,
  isAutomationOnlyAction,
  type ButtonAction,
} from './button';
import { canEditColumn } from './column-locks';
import { columnRegistry } from './index';
import type { ColumnTypeRegistry } from './registry';
import { findStatusLabel, statusValueSchema, type StatusSettings } from './status';

/**
 * Column types that never take a default value, whatever their registration. Derived and
 * server-managed types are refused by `registry.validateCell` already, so only these two (kept
 * static so a registry without the module still refuses them) are listed.
 */
export const DISALLOWED_DEFAULT_TYPES = new Set<string>(['button', 'time_tracking']);

/** Maximum byte length for serialized default values (10 KB). */
export const MAX_DEFAULT_VALUE_SIZE_BYTES = 10 * 1024;

/**
 * Validates a column definition against the column registry.
 * - Ensures the column type is registered.
 * - Validates column settings against the type's settingsSchema.
 * - Validates defaultValue with `registry.validateCell` (value schema, then the type's
 *   `validateValue` against the column's settings, so a status index or dropdown id that is not in
 *   the column's labels is refused), bounds its serialized size, and refuses defaults on button,
 *   time tracking, derived and server-managed types.
 */
export function validateColumnDef(
  col: ColumnDefInput | ColumnDef,
  registry: ColumnTypeRegistry,
): { valid: true } | { valid: false; error: string } {
  if (!registry.has(col.type)) {
    return { valid: false, error: `Unknown column type "${col.type}"` };
  }

  if (col.defaultValue !== undefined && DISALLOWED_DEFAULT_TYPES.has(col.type)) {
    return {
      valid: false,
      error: `Column type "${col.type}" does not support default values`,
    };
  }

  // Validate settings against column type
  const settingsParsed = registry.parseSettings(col.type, col.settings);
  if (!settingsParsed.success) {
    return {
      valid: false,
      error: `Invalid settings for column type "${col.type}": ${settingsParsed.error}`,
    };
  }

  // Validate default value if present
  if (col.defaultValue !== undefined) {
    try {
      const serialized = JSON.stringify(col.defaultValue);
      if (serialized.length > MAX_DEFAULT_VALUE_SIZE_BYTES) {
        return {
          valid: false,
          error: `Default value exceeds maximum allowed size of ${MAX_DEFAULT_VALUE_SIZE_BYTES} bytes`,
        };
      }
    } catch {
      return { valid: false, error: 'Default value must be JSON-serializable' };
    }

    // Derived and server-managed types refuse here too (validateCell bans any client value).
    const checked = registry.validateCell(col as ColumnDef, col.defaultValue);
    if (!checked.ok) {
      return {
        valid: false,
        error: `Invalid default value for column type "${col.type}": ${checked.message}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Checks whether a cell value is considered empty for a given column type.
 * Supports per-type representations: `{personsAndTeams: []}`, `{files: []}`, `{ids: []}`,
 * `{tag_ids: []}`, `{item_ids: []}`, `{linkedItems: []}`, empty strings, empty arrays, and empty objects.
 */
export function isColumnValueEmpty(type: string, value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim() === '';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Types whose empty value is not an empty collection: decided by the column type.
    switch (type) {
      case 'vote':
        return !Array.isArray(obj.votersIds) || obj.votersIds.length === 0;
      case 'long_text':
        return typeof obj.text !== 'string' || obj.text.trim() === '';
      case 'checkbox':
        return obj.checked === undefined || obj.checked === false || obj.checked === 'false';
      case 'rating':
        return obj.rating === undefined || obj.rating === 0;
      default:
        break;
    }

    // People column: { personsAndTeams: [] }
    if ('personsAndTeams' in obj && Array.isArray(obj.personsAndTeams)) {
      return obj.personsAndTeams.length === 0;
    }

    // Files column: { files: [] }
    if ('files' in obj && Array.isArray(obj.files)) {
      return obj.files.length === 0;
    }

    // Dropdown column: { ids: [] }
    if ('ids' in obj && Array.isArray(obj.ids)) {
      return obj.ids.length === 0;
    }

    // Tags column: { tag_ids: [] }
    if ('tag_ids' in obj && Array.isArray(obj.tag_ids)) {
      return obj.tag_ids.length === 0;
    }

    // Dependency column: { item_ids: [] }
    if ('item_ids' in obj && Array.isArray(obj.item_ids)) {
      return obj.item_ids.length === 0;
    }

    // Board relation: { linkedItems: [] }
    if ('linkedItems' in obj && Array.isArray(obj.linkedItems)) {
      return obj.linkedItems.length === 0;
    }

    // Status column: { index?: number, label?: string }
    if (type === 'status') {
      return (
        obj.index === undefined && (obj.label === undefined || String(obj.label).trim() === '')
      );
    }

    // Generic empty object {}
    return Object.keys(obj).length === 0;
  }

  return false;
}

/**
 * Validates that all columns marked `required: true` have non-empty values on the given item.
 * NOTE: This is UI-level validation to assist users before form submission.
 */
export function validateRequiredColumns(
  columns: readonly ColumnDef[],
  values: Record<string, unknown>,
): { valid: boolean; missingColumns: string[] } {
  const missingColumns: string[] = [];

  for (const col of columns) {
    if (!col.required) continue;
    const val = values[col.id];
    if (isColumnValueEmpty(col.type, val)) {
      missingColumns.push(col.id);
    }
  }

  return {
    valid: missingColumns.length === 0,
    missingColumns,
  };
}

/**
 * True when `value` is a Status cell that points at a label marked done (`isDone`). A non-status
 * column, an empty or malformed value, a label that no longer exists: false.
 */
export function isDoneStatusValue(
  col: Pick<ColumnDef, 'type' | 'settings'>,
  value: unknown,
): boolean {
  if (col.type !== 'status') return false;
  const parsed = statusValueSchema.safeParse(value);
  if (!parsed.success) return false;
  const settings = col.settings as Partial<StatusSettings> | null | undefined;
  if (!settings || !Array.isArray(settings.labels)) return false;
  return findStatusLabel(parsed.data, settings as StatusSettings)?.isDone === true;
}

export type RequiredWriteViolation =
  /** Rule 1: a written required cell ends up empty. */
  | { kind: 'cleared'; columnIds: string[] }
  /** Rule 2: a Status moved into a done label while other required cells are empty. */
  | { kind: 'done_with_empty'; statusColumnIds: string[]; missingColumns: string[] };

/**
 * Required columns a client can fill: derived, server-managed and button columns never hold a
 * client value, so they are not counted as "empty".
 */
function fillableRequired(
  columns: readonly ColumnDef[],
  registry: ColumnTypeRegistry,
): ColumnDef[] {
  return columns.filter(
    (c) =>
      c.required &&
      c.type !== 'button' &&
      !(registry.has(c.type) && (registry.isDerived(c.type) || registry.isServerManaged(c.type))),
  );
}

/**
 * Checks one item write against the required-columns hard rule
 * (docs/specs/REQ-required-columns-hard-rule.md). `before` and `after` are the item's whole
 * `values` maps. Creating an item is exempt: callers skip creates.
 *
 * - Rule 2 (`done_with_empty`): a Status column whose value was not a done label before and is one
 *   after, while any required column other than that Status is empty in `after`. An item that was
 *   already Done is never flagged for unrelated edits, and moving between two done labels is not
 *   "reaching" Done.
 * - Rule 1 (`cleared`): only when `options.written` is given (the column ids the write touched,
 *   for server-side writers whose patch is known): a written required column that is empty after.
 *
 * Returns `null` when the write is allowed; rule 1 is reported first.
 */
export function findRequiredViolation(
  columns: readonly ColumnDef[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  options: { written?: Iterable<string>; registry?: ColumnTypeRegistry } = {},
): RequiredWriteViolation | null {
  const registry = options.registry ?? columnRegistry;
  const required = fillableRequired(columns, registry);
  if (required.length === 0) return null;

  if (options.written) {
    const written = new Set(options.written);
    const cleared = required
      .filter((c) => written.has(c.id) && isColumnValueEmpty(c.type, after[c.id]))
      .map((c) => c.id);
    if (cleared.length > 0) return { kind: 'cleared', columnIds: cleared };
  }

  const reached = columns
    .filter((c) => isDoneStatusValue(c, after[c.id]) && !isDoneStatusValue(c, before[c.id]))
    .map((c) => c.id);
  if (reached.length === 0) return null;
  const missing = required
    .filter((c) => reached.some((id) => id !== c.id) && isColumnValueEmpty(c.type, after[c.id]))
    .map((c) => c.id);
  if (missing.length === 0) return null;
  return { kind: 'done_with_empty', statusColumnIds: reached, missingColumns: missing };
}

function cloneValue<T>(val: T): T {
  const globalClone = (globalThis as unknown as { structuredClone?: (v: T) => T }).structuredClone;
  if (typeof globalClone === 'function') {
    return globalClone(val);
  }
  return JSON.parse(JSON.stringify(val)) as T;
}

/**
 * Applies default values configured on columns to an item's values map
 * for any columns that do not already have an assigned value.
 * Uses structuredClone to ensure each item receives an independent deep copy of the default value.
 *
 * Derived and server-managed columns are skipped (clients never write them; rules refuse the
 * create). Locked columns are the caller's job: non-owners (`boardRole !== 'owner'`) must drop
 * `board.columnLocks` columns from the result (the table's `addItem` does) so Firestore rules do
 * not reject the item creation for writing a locked column key.
 */
export function applyDefaultColumnValues(
  columns: readonly ColumnDef[],
  values: Record<string, unknown> = {},
  registry: ColumnTypeRegistry = columnRegistry,
): Record<string, unknown> {
  const result = { ...values };

  for (const col of columns) {
    if (registry.isDerived(col.type) || registry.isServerManaged(col.type)) continue;
    if (col.defaultValue !== undefined && result[col.id] === undefined) {
      result[col.id] = cloneValue(col.defaultValue);
    }
  }

  return result;
}

export interface ButtonActionsBoard {
  columns: ReadonlyArray<{
    id: string;
    type: string;
    title?: string;
    settings?: unknown;
    migrating?: unknown;
  }>;
  groups: ReadonlyArray<{ id: string }>;
  columnLocks?: readonly string[] | null;
  /** Workspace member uids, when known: `notify` targets must be among them (the settings-time check skips it). */
  memberUids?: readonly string[] | null;
}

/**
 * Checks a button's actions against a board: target columns exist and are plain writable types
 * (not derived, server-managed, button or migrating), values pass `registry.validateCell`, move
 * targets exist and, when `role` is given, the role may edit each target column. Returns the
 * first failure with its 0-based `index` and a message naming the action. The automation-only
 * actions (`create_item`, `post_update`) are refused unless `options.automation` is set.
 */
export function validateButtonActions(
  actions: readonly ButtonAction[],
  board: ButtonActionsBoard,
  role?: BoardRole | null,
  registry: ColumnTypeRegistry = columnRegistry,
  options: { automation?: boolean } = {},
): { ok: true } | { ok: false; index: number; message: string } {
  /** Why `value` cannot be written to the column (null when it can): the `set_value` rules. */
  const checkWritableCell = (columnId: string, value: unknown): string | null => {
    const col = board.columns.find((c) => c.id === columnId);
    if (!col) return 'the column no longer exists';
    if (col.type === 'button') return 'a button column cannot be set';
    if (!registry.has(col.type)) return `unknown column type "${col.type}"`;
    if (registry.isDerived(col.type)) return 'the column is calculated';
    if (registry.isServerManaged(col.type)) return 'the column is managed by Atrium';
    if (col.migrating) return 'the column is changing type';
    if (role !== undefined && !canEditColumn(role, board, col.id)) {
      return 'the column is locked to board owners';
    }
    const checked = registry.validateCell(
      {
        id: col.id,
        type: col.type,
        title: col.title ?? col.id,
        position: 'a0',
        settings: (col.settings ?? {}) as Record<string, unknown>,
      },
      value,
    );
    return checked.ok ? null : checked.message;
  };
  for (const [index, action] of actions.entries()) {
    const fail = (reason: string) => ({
      ok: false as const,
      index,
      message: `Action ${index + 1} (${BUTTON_ACTION_LABELS[action.type]}): ${reason}`,
    });
    if (isAutomationOnlyAction(action.type) && !options.automation) {
      return fail('only available in automations');
    }
    if (action.type === 'set_value') {
      const reason = checkWritableCell(action.columnId, action.value);
      if (reason) return fail(reason);
    } else if (action.type === 'notify') {
      if (action.uids.length < 1 || action.uids.length > BUTTON_LIMITS.maxNotifyUids) {
        return fail(`choose 1 to ${BUTTON_LIMITS.maxNotifyUids} people`);
      }
      if (new Set(action.uids).size !== action.uids.length) return fail('a person is listed twice');
      if ((action.message?.length ?? 0) > BUTTON_LIMITS.maxNotifyMessage) {
        return fail(`the message is longer than ${BUTTON_LIMITS.maxNotifyMessage} characters`);
      }
      const members = board.memberUids;
      if (members && action.uids.some((uid) => !members.includes(uid))) {
        return fail('a chosen person is no longer a workspace member');
      }
    } else if (action.type === 'move_to_group') {
      if (!board.groups.some((g) => g.id === action.groupId)) {
        return fail('the group no longer exists');
      }
    } else if (action.type === 'create_item') {
      if (action.groupId !== undefined && !board.groups.some((g) => g.id === action.groupId)) {
        return fail('the group no longer exists');
      }
      const entries = Object.entries(action.values ?? {});
      if (entries.length > BUTTON_LIMITS.maxCreateValues) {
        return fail(`at most ${BUTTON_LIMITS.maxCreateValues} values`);
      }
      for (const [columnId, value] of entries) {
        const reason = checkWritableCell(columnId, value);
        if (reason) return fail(reason);
      }
    }
  }
  return { ok: true };
}
