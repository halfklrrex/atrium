import type { ColumnDef } from '../schemas/board';
import type {
  AggregateResult,
  AnyColumnType,
  ColumnContext,
  ColumnType,
  ValidationResult,
} from './types';

/** Message for any attempt to write a derived cell. */
export const DERIVED_WRITE_MESSAGE = 'This column is calculated automatically';

/** Message for any client attempt to write a server-managed cell (time tracking, files, buttons). */
export const SERVER_MANAGED_WRITE_MESSAGE = 'This column is updated by Atrium automatically';

export class UnknownColumnTypeError extends Error {
  constructor(readonly columnType: string) {
    super(`Unknown column type "${columnType}"`);
    this.name = 'UnknownColumnTypeError';
  }
}

export type ParseResult<T> = { success: true; data: T } | { success: false; error: string };

function describeIssues(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/** Identity helper that gives column-type modules full inference on their own generics. */
export function defineColumnType<Settings, Value>(
  def: ColumnType<Settings, Value>,
): ColumnType<Settings, Value> {
  return def;
}

/** Registry of column types keyed by `type`. */
export class ColumnTypeRegistry {
  private readonly types = new Map<string, AnyColumnType>();

  /** Register a type. Throws on duplicate so two modules can never silently shadow each other. */
  register<Settings, Value>(columnType: ColumnType<Settings, Value>): this {
    if (this.types.has(columnType.type)) {
      throw new Error(`Column type "${columnType.type}" is already registered`);
    }
    if (columnType.derived === true && typeof columnType.compute !== 'function') {
      throw new Error(`Derived column type "${columnType.type}" must define compute()`);
    }
    // Type parameters are erased on purpose: callers go through the validating helpers below.
    this.types.set(columnType.type, columnType as unknown as AnyColumnType);
    return this;
  }

  /** True for types whose value is computed, never stored. Unknown types are not derived. */
  isDerived(type: string): boolean {
    return this.types.get(type)?.derived === true;
  }

  /** True for types only Cloud Functions write (FW2). Unknown types are not server-managed. */
  isServerManaged(type: string): boolean {
    return this.types.get(type)?.serverManaged === true;
  }

  /**
   * Display value of a derived column for one item; `null` for unknown or non-derived types, for
   * invalid settings, and when the type computes nothing.
   */
  computeValue(def: ColumnDef, ctx: ColumnContext): unknown {
    const columnType = this.types.get(def.type);
    if (!columnType || columnType.derived !== true || !columnType.compute) return null;
    const settings = columnType.settingsSchema.safeParse(def.settings);
    if (!settings.success) return null;
    return columnType.compute(ctx, settings.data) ?? null;
  }

  /**
   * Gate for every client cell write. Derived and server-managed columns refuse any value (even
   * `null`); otherwise the value must pass `valueSchema` and then the type's `validateValue`. Empty
   * cells are always valid.
   */
  validateCell(def: ColumnDef, value: unknown, ctx?: ColumnContext): ValidationResult {
    const columnType = this.types.get(def.type);
    if (!columnType) return { ok: false, message: `Unknown column type "${def.type}"` };
    if (columnType.derived === true) return { ok: false, message: DERIVED_WRITE_MESSAGE };
    if (columnType.serverManaged === true)
      return { ok: false, message: SERVER_MANAGED_WRITE_MESSAGE };
    if (value === null || value === undefined) return { ok: true };
    const parsed = columnType.valueSchema.safeParse(value);
    if (!parsed.success) return { ok: false, message: describeIssues(parsed.error) };
    if (!columnType.validateValue) return { ok: true };
    const settings = columnType.settingsSchema.safeParse(def.settings);
    return columnType.validateValue(
      parsed.data,
      settings.success ? settings.data : columnType.defaultSettings(),
      ctx,
    );
  }

  /** Ids of the columns whose type is derived (order kept), ready for `boards/{id}.derivedColumnIds`. */
  derivedColumnIds(columns: readonly ColumnDef[]): string[] {
    return columns.filter((c) => this.isDerived(c.type)).map((c) => c.id);
  }

  /**
   * Ids of the columns whose type is server-managed (order kept), ready for
   * `boards/{id}.serverManagedColumnIds`.
   */
  serverManagedColumnIds(columns: readonly ColumnDef[]): string[] {
    return columns.filter((c) => this.isServerManaged(c.type)).map((c) => c.id);
  }

  has(type: string): boolean {
    return this.types.has(type);
  }

  /** Returns the type or `undefined`. */
  find(type: string): AnyColumnType | undefined {
    return this.types.get(type);
  }

  /** Returns the type or throws {@link UnknownColumnTypeError}. */
  get(type: string): AnyColumnType {
    const found = this.types.get(type);
    if (!found) throw new UnknownColumnTypeError(type);
    return found;
  }

  list(): AnyColumnType[] {
    return [...this.types.values()];
  }

  /** Fresh default settings for a new column of `type`. */
  defaultSettings(type: string): unknown {
    return this.get(type).defaultSettings();
  }

  parseSettings(type: string, settings: unknown): ParseResult<unknown> {
    const result = this.get(type).settingsSchema.safeParse(settings);
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: describeIssues(result.error) };
  }

  /** Validates a cell value. `null`/`undefined` is an empty cell and is always valid. */
  parseValue(type: string, value: unknown): ParseResult<unknown> {
    if (value === null || value === undefined) return { success: true, data: null };
    const result = this.get(type).valueSchema.safeParse(value);
    return result.success
      ? { success: true, data: result.data }
      : { success: false, error: describeIssues(result.error) };
  }

  /** Text rendering of a cell; empty cells render as an empty string. */
  toText(type: string, value: unknown, settings: unknown): string {
    if (value === null || value === undefined) return '';
    const parsed = this.parseValue(type, value);
    if (!parsed.success) return '';
    return this.get(type).toText(parsed.data, settings);
  }

  /**
   * Footer summary of a group's cells for `type`. Cells that fail validation count as empty.
   * `null` when the type has no footer summary.
   */
  aggregate(type: string, values: readonly unknown[], settings: unknown): AggregateResult | null {
    const columnType = this.get(type);
    if (!columnType.aggregate) return null;
    const parsed = values.map((v) => {
      const result = this.parseValue(type, v);
      return result.success ? result.data : null;
    });
    return columnType.aggregate(parsed, settings);
  }

  /** Sort comparator over possibly-empty cells; empty cells always sort last. */
  compare(type: string, a: unknown, b: unknown, settings: unknown): number {
    const aEmpty = a === null || a === undefined;
    const bEmpty = b === null || b === undefined;
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
    return this.get(type).compare(a, b, settings);
  }
}
