import type { ColumnDef } from '@atrium/shared';
import type { SubIcon } from '@vibe/core';
import type { ComponentType } from 'react';

/** Row-level context a cell may need beyond its own value. */
export interface CellContext {
  /** Search term to highlight in text, empty when not searching. */
  highlight: string;
  /** True when the row's first status column holds a "done" label (dates then never turn red). */
  rowDone: boolean;
  canEdit: boolean;
  /** Board ID for server-managed callable actions (files, button, time tracking). */
  boardId?: string;
  /** Item ID for server-managed callable actions (files, button, time tracking). */
  itemId?: string;
  /** True when the user can edit the board (used by server-managed cells whose client `canEdit` is false). */
  canAct?: boolean;
}

export interface CellProps<Value, Settings> {
  /** The validated value; `null` for an empty cell. */
  value: Value | null;
  /** Settings validated by the shared registry (defaults when the stored ones are invalid). */
  settings: Settings;
  column: ColumnDef;
  ctx: CellContext;
  /** Write a new value (`null` clears it). A no-op for viewers. */
  onChange: (value: Value | null) => void;
}

export interface EditorProps<Value, Settings> extends CellProps<Value, Settings> {
  /** Close the editor (after saving, or to cancel). */
  onClose: () => void;
  /** The cell element popovers hang from (`null` for one frame while it is looked up). */
  anchor: HTMLElement | null;
  /** Replace the column's settings (status labels, dropdown labels). */
  saveSettings: (settings: Settings) => void;
}

/**
 * How a column type is edited:
 * - `inline`: the editor replaces the cell content (text, numbers)
 * - `popover`: the cell stays and a panel opens under it (status, date, people...)
 * - `toggle`: a click flips the value, no editor (checkbox)
 * - `none`: display only
 */
export type EditorKind = 'inline' | 'popover' | 'toggle' | 'none';

/** Visual tone of the type's tile in the "add column" picker (mapped to Vibe colours in CSS). */
export type TileTone =
  'green' | 'orange' | 'blue' | 'purple' | 'pink' | 'teal' | 'indigo' | 'red' | 'grey';

/**
 * Web-side half of a column type (the shared half lives in `@atrium/shared`): how it is drawn and
 * edited in the board table. Register it in `columns/registry.ts`.
 */
export interface ColumnUi<Value = unknown, Settings = unknown> {
  type: string;
  icon: SubIcon;
  tone: TileTone;
  editor: EditorKind;
  /** The cell's display. Must stay light: a board renders thousands of these. */
  Cell: ComponentType<CellProps<Value, Settings>>;
  /** The editor, for `inline` and `popover` types. */
  Editor?: ComponentType<EditorProps<Value, Settings>>;
  /** For `toggle` types: the value a click produces. */
  toggle?: (current: Value | null) => Value | null;
}

/** A column UI with its value and settings types erased (what the registry stores). */
export type AnyColumnUi = ColumnUi<unknown, unknown>;

/** Identity helper that infers the value and settings types, then erases them for the registry. */
export function defineColumnUi<Value, Settings>(ui: ColumnUi<Value, Settings>): AnyColumnUi {
  return ui as unknown as AnyColumnUi;
}
