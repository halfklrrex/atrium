# P2: Computed & System Column Types (progress, auto number, item ID, creation log, last updated)

Author: Ava (Antigravity) · Implementer: Ava (Antigravity) · Status: Ready / Built  
Roadmap epic: P2 "Progress, auto number, item ID, creation log, last updated" (ID: 3306218928)

## 1. Overview & Data Shapes

These 5 column types represent automated, calculated, or system-managed metadata columns on monday boards. They follow standard monday data models, provide robust schema validation via Zod, and export plain-text formatters, compute helpers, and sorting comparators.

**Derived types** (`item_id`, `creation_log`, `last_updated`, `progress`) store no user-writable values in `item.values`. They are marked with `// TODO(derived)`: client writes will be rejected once `ColumnType` introduces the `derived: true` framework flag. They provide standalone `compute` helpers to derive values from item metadata or referenced cells. `auto_number` is a server-assigned counter written only by backend Functions.

All schemas implement `ColumnType<Settings, Value>` in `packages/shared/src/columns/types.ts` and are registered in `columnRegistry` via `packages/shared/src/columns/index.ts`.

### 1.1 `item_id` (Item ID) — Derived (`// TODO(derived)`)

- **Type identifier:** `item_id`
- **Label:** `Item ID`
- **Settings schema:**
  ```ts
  z.object({
    displayType: z.enum(['id', 'customKey']).default('id'),
    customKeySettings: z
      .object({
        prefix: z.string().max(20).default(''),
      })
      .strict()
      .optional(),
  })
    .strict()
    .superRefine((data, ctx) => {
      if (data.displayType === 'customKey' && !data.customKeySettings) {
        ctx.addIssue({
          code: 'custom',
          path: ['customKeySettings'],
          message: 'customKeySettings is required when displayType is customKey',
        });
      }
    });
  ```
- **Value schema:** String ID (derived from `item.id`).
- **Compute helper:** `computeItemId(item, settings)` and `formatItemId(id, settings)`. Shows the short id (or prefixed custom key).
- **Plain-text representation:** Formatted item ID string via `formatItemId(value, settings)`.
- **Comparator:** Natural numerical comparison when string matches `/^\d+$/`; lexicographical string comparison otherwise.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`.

### 1.2 `auto_number` (Auto Number)

- **Type identifier:** `auto_number`
- **Label:** `Auto Number`
- **Settings schema:**
  ```ts
  z.object({
    scope: z.enum(['board', 'group']).default('board'),
    prefix: z.string().max(20).optional(),
    order: z.enum(['ascending', 'descending']).default('ascending'),
  }).strict();
  ```
- **Value schema:** `{ auto_number: z.number().int().min(0) }` (strict object, server-assigned).
- **Plain-text representation:** Prefixed number string (e.g. `"REQ-5"`, `"1"`).
- **Comparator:** Numerical order.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`, `min`, `max`, `average`, `sum`.

### 1.3 `creation_log` (Creation Log) — Derived (`// TODO(derived)`)

- **Type identifier:** `creation_log`
- **Label:** `Creation Log`
- **Settings schema:**
  ```ts
  z.object({
    mode: z.enum(['personOnly', 'dateOnly', 'personAndDate']).default('personAndDate'),
  }).strict();
  ```
- **Value schema:**
  ```ts
  z.object({
    created_at: z.iso.datetime(),
    creator_id: z.string().min(1).max(128).optional(),
  }).strict();
  ```
- **Compute helper:** `computeCreationLog(item)` extracts from `createdAt` / `createdBy` using shared `timestampToIso` (supports ISO string, Date, or Firestore `{ toDate(): Date }`, returning null if pending server timestamp).
- **Plain-text representation:** Formatted according to `mode` (`dateOnly`, `personOnly`, or `personAndDate`).
- **Comparator:** Chronological order.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`, `earliest`, `latest`.

### 1.4 `last_updated` (Last Updated) — Derived (`// TODO(derived)`)

- **Type identifier:** `last_updated`
- **Label:** `Last Updated`
- **Settings schema:**
  ```ts
  z.object({
    mode: z.enum(['personOnly', 'dateOnly', 'personAndDate']).default('personAndDate'),
  }).strict();
  ```
- **Value schema:**
  ```ts
  z.object({
    updated_at: z.iso.datetime(),
    updater_id: z.string().min(1).max(128).optional(),
  }).strict();
  ```
- **Compute helper:** `computeLastUpdated(item)` extracts from `updatedAt` / `updatedBy` using shared `timestampToIso`.
- **Plain-text representation:** Formatted according to `mode` (`dateOnly`, `personOnly`, or `personAndDate`).
- **Comparator:** Chronological order.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`, `earliest`, `latest`.

### 1.5 `progress` (Progress Tracking) — Derived (`// TODO(derived)`)

- **Type identifier:** `progress`
- **Label:** `Progress`
- **Settings schema:**
  ```ts
  z.object({
    related_columns: z
      .object({
        isNormalized: z.boolean(),
        columns: z.record(
          z.string(),
          z
            .object({
              isSelected: z.boolean(),
              percentage: z.number().min(0).max(100),
            })
            .strict(),
        ),
      })
      .strict(),
  }).strict();
  ```
- **Value schema:** `{ progress: z.number().int().min(0).max(100) }` (strict object).
- **Compute helper:** `computeProgress(item, settings, statusColumns)` calculates overall progress (0..100) from referenced status columns by parsing with `statusValueSchema` and checking `findStatusLabel(parsed, settings)?.isDone`.
- **Plain-text representation:** Percentage string with percent symbol (e.g. `"75%"`).
- **Comparator:** Numerical percentage order.
- **Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`, `average`, `min`, `max`, `sum`.

## 2. Test Coverage

Comprehensive unit tests are implemented in `packages/shared/src/columns/computed-columns.test.ts` covering schemas, settings, value shapes, compute helpers, serializers, comparators, edge cases, and `timestampToIso`, with registry integration tested in `packages/shared/src/columns/registry.test.ts`.
