import type { ColumnDef, ColumnDefInput } from '../schemas/board';
import type { ColumnTypeRegistry } from './registry';

/**
 * Column types that do not support a default value.
 * Buttons, time tracking, and purely derived columns cannot have a default cell value.
 */
export const DISALLOWED_DEFAULT_TYPES = new Set<string>([
  'button',
  'time_tracking',
  'progress',
  'auto_number',
  'item_id',
  'creation_log',
  'last_updated',
  'mirror',
  'formula',
]);

/** Maximum byte length for serialized default values (10 KB). */
export const MAX_DEFAULT_VALUE_SIZE_BYTES = 10 * 1024;

/**
 * Validates a column definition against the column registry.
 * - Ensures the column type is registered.
 * - Validates column settings against the type's settingsSchema.
 * - Validates defaultValue against the type's valueSchema, bounds its serialized size,
 *   and ensures the type supports default values (rejected on button, time tracking, derived types).
 */
export function validateColumnDef(
  col: ColumnDefInput | ColumnDef,
  registry: ColumnTypeRegistry,
): { valid: true } | { valid: false; error: string } {
  if (!registry.has(col.type)) {
    return { valid: false, error: `Unknown column type "${col.type}"` };
  }

  // Check if type allows defaults before validating settings
  // Derived and server-managed types (FW2) can never hold a client-written default, whether or not
  // they are in the static list above (e.g. `files`, once its module sets `serverManaged`).
  if (
    col.defaultValue !== undefined &&
    (DISALLOWED_DEFAULT_TYPES.has(col.type) ||
      registry.isDerived(col.type) ||
      registry.isServerManaged(col.type))
  ) {
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

    const valueParsed = registry.parseValue(col.type, col.defaultValue);
    if (!valueParsed.success) {
      return {
        valid: false,
        error: `Invalid default value for column type "${col.type}": ${valueParsed.error}`,
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
 */
export function applyDefaultColumnValues(
  columns: readonly ColumnDef[],
  values: Record<string, unknown> = {},
): Record<string, unknown> {
  const result = { ...values };

  for (const col of columns) {
    if (col.defaultValue !== undefined && result[col.id] === undefined) {
      result[col.id] = cloneValue(col.defaultValue);
    }
  }

  return result;
}
