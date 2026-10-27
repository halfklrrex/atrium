import type { z } from 'zod';
import type { ColumnDef } from '../schemas/board';

/** Aggregations a column can offer in a group footer. */
export type SummaryKind =
  | 'count'
  | 'count_filled'
  | 'count_empty'
  | 'percent_filled'
  | 'distribution'
  | 'sum'
  | 'average'
  | 'min'
  | 'max'
  | 'earliest'
  | 'latest';

/** One slice of a status footer battery. `label` is empty for the "no value" slice. */
export interface DistributionSegment {
  key: string;
  label: string;
  color: string;
  count: number;
}

/**
 * Result of a column type's footer aggregation (P1b spec section 4). Plain data, so the web app
 * decides how to draw it and Functions can reuse it.
 */
export type AggregateResult =
  /** Status: how many cells carry each label (including the empty one). */
  | { kind: 'distribution'; total: number; segments: DistributionSegment[] }
  /** Numbers: the sum of the filled cells. */
  | { kind: 'sum'; sum: number; count: number }
  /** Date: earliest and latest `YYYY-MM-DD` of the filled cells. */
  | { kind: 'range'; earliest: string; latest: string }
  /** Checkbox: how many cells are ticked out of all cells. */
  | { kind: 'ratio'; filled: number; total: number };

/**
 * What a derived value or a settings-dependent validation can see (architecture section 6). Plain
 * data the client already holds, so it stays cheap to build and safe to use in Functions.
 */
export interface ColumnContext {
  boardId: string;
  item: {
    id: string;
    values: Record<string, unknown>;
    createdAt?: unknown;
    createdBy?: string;
    updatedAt?: unknown;
    updatedBy?: string;
    groupId?: string;
    /** Account-wide item number, assigned by the `onItemCreated` Function (absent until then). */
    seq?: number;
    /** Per-board creation number (own sequence for subitems), assigned by the same Function. */
    boardSeq?: number;
  };
  /** All column defs of the board (for cross-column derivations like progress/formula). */
  columns: readonly ColumnDef[];
}

/** Outcome of validating one cell write. */
export type ValidationResult = { ok: true } | { ok: false; message: string };

/**
 * One column type (architecture §6). `Value` is the monday-compatible JSON shape stored in
 * `items/{id}.values[columnId]`; an empty cell is `null`/absent and never reaches these functions
 * as a value.
 */
export interface ColumnType<Settings = unknown, Value = unknown> {
  /** Stable type slug, e.g. `text`, `status`. Stored on every `ColumnDef`. */
  readonly type: string;
  /** Human readable name for the "add column" picker. */
  readonly label: string;
  readonly settingsSchema: z.ZodType<Settings>;
  readonly valueSchema: z.ZodType<Value>;
  readonly summaries?: readonly SummaryKind[];
  defaultSettings(): Settings;
  /** Plain-text rendering used for search, CSV export and the API `text` field. */
  toText(value: Value, settings: Settings): string;
  /** Sort comparator over two non-empty values. */
  compare(a: Value, b: Value, settings: Settings): number;
  /**
   * The default group-footer summary over every cell of the group (`null` = empty cell). Types
   * without a footer summary leave it out and the footer cell stays blank.
   */
  aggregate?(
    values: readonly (Value | null | undefined)[],
    settings: Settings,
  ): AggregateResult | null;
  /**
   * True when the type's value is computed and never stored (formula, mirror, progress, item ID,
   * creation log, last updated). Clients can't write such cells; Firestore rules enforce it through
   * `boards/{id}.derivedColumnIds`. Requires {@link ColumnType.compute} (checked at registration).
   */
  readonly derived?: boolean;
  /**
   * True when only Cloud Functions write the type's cell (through the Admin SDK, which bypasses
   * rules): time tracking, files and buttons. Clients can't write such cells, for example because a
   * callable must stamp server time and uid or write trusted file metadata; Firestore rules enforce
   * it through `boards/{id}.serverManagedColumnIds` (FW2). Unlike {@link ColumnType.derived} the
   * value is stored, and clients still read it.
   */
  readonly serverManaged?: boolean;
  /** Derived types: compute the display value for one item. Must be pure and fast. */
  compute?(ctx: ColumnContext, settings: Settings): Value | null;
  /**
   * Settings-dependent validation beyond `valueSchema` (e.g. rating <= limit). Pure. Runs after the
   * value passed `valueSchema`, only for non-empty values.
   */
  validateValue?(value: Value, settings: Settings, ctx?: ColumnContext): ValidationResult;
}

/** Column type as held by the registry (type parameters erased). */
export type AnyColumnType = ColumnType<unknown, unknown>;
