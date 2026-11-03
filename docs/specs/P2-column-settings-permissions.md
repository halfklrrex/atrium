# P2 Spec: Column Settings, Defaults, and Required Validation

**Epic:** Column settings & defaults  
**Roadmap Item:** `3306293031` (Phase P2: Full Column Library)  
**Agent:** Antigravity (Codename: Ava)  
**Branch:** `ag/column-settings-permissions`

---

## 1. Overview & Architectural Boundaries

> [!IMPORTANT]
> **Scope & Security Clarification:**
> Client-side column permission flags (`view: 'owners'`, `edit: 'owners'`) have been removed from this epic. As noted by Technical Lead Ophelia:
>
> 1. Board readers read all `values` on the item document, making client-side `view: 'owners'` false security.
> 2. Board editors can write `values` and edit `boards.columns`, so client-side edit flags can be bypassed or deleted.
>    Security-enforced **Column Locks** are tracked as a separate security feature in **Roadmap Item `3307068576`** (with owner-only `columnLocks` on the board doc, Firestore security rules denying editor writes to locked `values` paths, and emulator test suites).
>
> This epic delivers **UI-level validation, default values, and column definition verification**.

---

## 2. Data Models & Schemas

### 2.1 `ColumnDef` and `ColumnDefInput`

```ts
export const columnDefSchema = z.object({
  id: slugIdSchema,
  type: z.string().min(1).max(40),
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  width: z.number().int().min(40).max(1200).optional(),
  position: positionSchema,
  settings: z.record(z.string(), z.unknown()),
  /** Optional default value populated when creating new items (UI-level validation). */
  defaultValue: z.unknown().optional(),
  /** Whether filling this column is required when creating / editing items (UI-level validation). */
  required: z.boolean().optional(),
  /** Whether this column is collapsed in the table header. */
  collapsed: z.boolean().optional(),
  /** Cosmetic flag indicating whether this column is hidden from table views. */
  hidden: z.boolean().optional(),
});
export type ColumnDef = z.infer<typeof columnDefSchema>;
export type ColumnDefInput = z.input<typeof columnDefSchema>;
```

---

## 3. Validation & Default Helpers

### 3.1 Definition Verification: `validateColumnDef(col, registry)`

Validates that:

1. `col.type` is registered in `ColumnTypeRegistry`.
2. `col.settings` satisfies the column type's `settingsSchema`.
3. If `col.defaultValue !== undefined`:
   - `col.type` must support default values (rejected on `'button'`, `'time_tracking'`, and derived types `'progress'`, `'auto_number'`, `'item_id'`, `'creation_log'`, `'last_updated'`, `'mirror'`).
   - `JSON.stringify(col.defaultValue).length <= 10240` (10 KB max size limit).
   - `col.defaultValue` satisfies the column type's `valueSchema`.

### 3.2 Emptiness Check: `isColumnValueEmpty(type, value)`

Determines whether a cell value is considered empty for UI requirement checks:

- `undefined`, `null`, `""`, whitespace string -> empty.
- `0`, `false` -> **not empty**.
- Arrays: empty if `length === 0`.
- People: empty if `personsAndTeams` array is empty.
- Files: empty if `files` array is empty.
- Dropdown: empty if `ids` array is empty.
- Tags: empty if `tag_ids` array is empty.
- Dependency: empty if `item_ids` array is empty.
- Board relation: empty if `linkedItems` array is empty.
- Status: empty if `index` and `label` are not set.
- Empty object `{}` -> empty.

### 3.3 Required Fields: `validateRequiredColumns(columns, values)`

UI-level validation returning `{ valid: boolean, missingColumns: string[] }` by evaluating `isColumnValueEmpty` across all columns marked `required: true`.

### 3.4 Applying Defaults: `applyDefaultColumnValues(columns, values)`

Populates missing columns with deep copies using `structuredClone(col.defaultValue)` to prevent cross-row mutation. Pre-existing values on the item are strictly preserved.

## 4. Addendum (2026-11-03, Ophelia): finishing the UI

Sign-off review found that the shared helpers and tests match sections 2 and 3, but two pieces of UI are missing. Column locks are a separate item (`P2-column-locks.md`) and are not part of this addendum.

### 4.1 Decisions

1. **"Required" is a soft rule.** Items are created empty, so a hard block would make "+ Add item" unusable. An empty required cell shows a "Required" hint; nothing is blocked. If the owner wants a hard rule somewhere (for example when an item moves to a Done status), that is a later, separate decision. This default is reversible and costs no data change.
2. **Checkbox and rating emptiness stays as implemented** (`{checked:false}` and rating `0` count as empty, so a required checkbox must be ticked). Document it in section 3.2 and keep the existing test.

### 4.2 Default value editor

In the column menu's settings (`apps/web/src/components/board-table/ColumnSettings.tsx`, and the header menu in `HeaderRow.tsx` where "Required column" lives), add a **Default value** row for every column type except derived, server-managed, `button` and `time_tracking` (`validateColumnDef` already refuses those; hide the row for them).

- Reuse the column type's own `Editor`/`Cell` component for the value, as the Button action editor does (`ButtonActionsEditor.tsx`, `set_value`), inside a small popover or inline box with a "Clear default" action.
- Save through the existing `updateColumn` patch (`defaultValue`, `table-actions.ts`), which re-runs `validateColumnDef`; show its error message when it refuses.
- Applying defaults to new items already works (`newItemValues` in `derived.ts`), so a test must prove the new editor's value reaches `addItem`.

### 4.3 Description field

A **Description** textarea in the same settings (max 500 characters, counter shown) saved with `updateColumn`. Show it as a tooltip on the column header title and in the item card's field label when present. (`description` already exists on `ColumnDef`.)

### 4.4 Required hint

- Table cell: when the column is `required` and `isColumnValueEmpty`, the cell shows a subtle "Required" placeholder text in the empty state (token colours only, no red fill; do not change row height).
- Item card field: the same hint, plus the required marker next to the label (the header already has one).
- Derived and server-managed columns never show it. Nothing blocks saving.
- `validateRequiredColumns` is used for the item card's "N required fields are empty" line near the title (hidden when 0).

### 4.5 Tests and checks

Web tests for each editor (default saved, invalid default refused with the message, cleared), the description limit, the hint shown and hidden, and defaults flowing into `addItem` and `addSubitem`. Visual screen: column settings with Default value and Description (light and dark). No shared, rules or Functions change is expected; if one is needed, stop and report it.
