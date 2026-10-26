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
