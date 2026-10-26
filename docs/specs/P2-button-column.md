# P2 Spec: Button Column

**Epic:** Button column  
**Roadmap Item:** `3306219470` (Phase P2: Full Column Library)  
**Agent:** Antigravity (Codename: Ava)  
**Branch:** `ag/column-button`

---

## 1. Overview & Architecture

Like monday.com, a button in Atrium has **no stored cell value** in Firestore (`values.<colId>`). Button appearance (label and colour) is configured uniformly at the column level within column settings.

- **No Stored Cell Value**: `buttonValueSchema` strictly accepts an empty object (`z.object({}).strict()`). Cell-level overrides are disallowed. Client writes to cell values will be rejected when `derived: true` is enabled across the framework.
- **Backend Callable Clicks**: Button clicks do not update cell data directly. In Phase P5 (Roadmap item `3307097019`: _Server-side column actions_), clicking a button invokes a backend Cloud Function callable. The callable checks board edit access and appends an immutable audit event to `boards/{boardId}/activity` (architecture §5.6: append-only, Cloud Functions only). The automation engine consumes this event to trigger workflows.
- **Security & XSS Prevention**: External URL templates (`actionType: 'url'`, `urlTemplate`) have been dropped to eliminate potential stored XSS (`javascript:` schemes).
- **Design System Palette**: Button color defaults to Atrium's standard palette blue (`#579bfc`, matching Vibe `--color-bright-blue`).
- **Summaries**: Displays column item count; meaningless `count_filled` and `percent_filled` summaries have been omitted.

---

## 2. Data Models & Schemas

### 2.1 Settings Schema (`buttonSettingsSchema`)

```ts
export const buttonSettingsSchema = z
  .object({
    /** Label displayed inside the button (e.g. "Run", "Approve", "Submit"). */
    label: z.string().min(1).max(50).default('Click'),
    /** Button color matching Atrium's status/group palette. */
    color: hexColorSchema.default('#579bfc'),
  })
  .strict();
```

### 2.2 Value Schema (`buttonValueSchema`)

```ts
// TODO(derived): client writes will be rejected when ColumnType gets derived: true.
export const buttonValueSchema = z.object({}).strict();
export type ButtonValue = z.infer<typeof buttonValueSchema>;
```

---

## 3. Behaviors

- **Text Representation (`toText`)**: Returns `settings.label` (e.g. `"Click"`).
- **Sorting (`compare`)**: Returns `0` (stable, non-ordering).
- **Summaries**: `['count', 'count_empty']`.
