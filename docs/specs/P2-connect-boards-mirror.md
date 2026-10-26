# P2: Connect Boards & Mirror Columns

Author: Ava (Antigravity) · Implementer: Ava (Antigravity) · Lead: Ophelia (Claude Opus 5.5) · Status: Ready / Built  
Roadmap epic: P2 "Connect boards & mirror columns" (ID: 3306234642)

## 1. Relational Architecture & Security Design

The Connect Boards (`board_relation`) and Mirror (`mirror`) columns provide relational capabilities between boards, adhering strictly to monday.com's data model and Atrium's security architecture:

1. **Client-Side Virtual Evaluation:**
   - Mirrors are computed **client-side** from linked items that the authenticated user can read.
   - Denied boards simply contribute nothing (fail closed gracefully).
   - Any future server-side materialisation (search, export, automations, API) must check the caller's board access explicitly.
2. **Board Relation Resolution Strategy:**
   - Because Firestore item IDs are only guaranteed unique within their parent board, references are stored internally as `{ boardId, itemId }` pairs in `linkedItems` (rather than bare IDs). The P11 monday importer maps monday's `linkedPulseIds` into these pairs.
3. **Board Connection Security:**
   - `settings.boardIds` cannot be checked directly by Firestore client security rules. Adding a board to a relation will go through a Cloud Function callable that verifies `canReadBoard` (follow-up item).
   - Two-way relations are maintained by a Cloud Function that checks edit access on the target board (follow-up item).

---

## 2. Data Shapes & Column Definitions

### 2.1 Connect Boards (`board_relation`)

The `board_relation` column stores references to items located on one or more target boards.

- **Type Identifier:** `board_relation`
- **Label:** `Connect boards`
- **Value Schema:**
  ```ts
  z.object({
    linkedItems: z
      .array(
        z
          .object({
            boardId: z.string().min(1).max(128),
            itemId: z.string().min(1).max(128),
          })
          .strict(),
      )
      .max(1000)
      .refine(
        (items) => {
          const keys = new Set(items.map((i) => `${i.boardId}:${i.itemId}`));
          return keys.size === items.length;
        },
        { message: 'linkedItems must be unique {boardId, itemId} pairs' },
      ),
  }).strict();
  ```
- **Settings Schema:**
  ```ts
  z.object({
    boardIds: z
      .array(z.string().min(1).max(128))
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'boardIds must be unique',
      })
      .default([]),
    allowMultipleItems: z.boolean().default(true),
    twoWay: z.boolean().default(false),
    twoWayColumnId: z.string().min(1).max(64).optional(),
  })
    .strict()
    .superRefine((data, ctx) => {
      if (data.twoWay && !data.twoWayColumnId) {
        ctx.addIssue({
          code: 'custom',
          path: ['twoWayColumnId'],
          message: 'twoWayColumnId is required when twoWay is true',
        });
      }
      if (!data.twoWay && data.twoWayColumnId !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['twoWayColumnId'],
          message: 'twoWayColumnId cannot be set when twoWay is false',
        });
      }
    });
  ```
- **Constraint Validator:** `isRelationWithinSettings(value, settings)` verifies `allowMultipleItems` (max 1 when false) and allowed `boardIds`.
- **Plain-text Representation:** Comma-separated item IDs (e.g. `"item-1, item-2"`), or empty string if empty.
- **Comparator:** Sorts by number of linked items, then lexicographically.
- **Supported Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`.

---

### 2.2 Mirror (`mirror`) — Derived (`// TODO(derived)`)

The `mirror` column is a **purely derived column**. In accordance with the project architecture, derived columns do not persist values in `item.values`. Instead, their values are dynamically computed from the linked items in a connected `board_relation` column.

- **Type Identifier:** `mirror`
- **Label:** `Mirror`
- **Value Schema:** Marked `// TODO(derived)` (rejected on write when derived flag lands).
  ```ts
  z.object({
    mirroredValues: z.array(z.unknown()),
    displayValue: z.string(),
  }).strict();
  ```
- **Settings Schema:**
  ```ts
  z.object({
    relationColumnId: z.string().max(64).default(''),
    targetColumnIds: z.record(z.string().min(1).max(128), z.string().min(1).max(64)).default({}),
    aggregation: z
      .enum([
        'none',
        'count',
        'count_filled',
        'count_empty',
        'percent_filled',
        'sum',
        'average',
        'min',
        'max',
        'earliest',
        'latest',
      ])
      .default('none'),
  }).strict();
  ```
- **Compute Helper:** `computeMirror(item, settings, connectedItems, targetColumns, registry)`:
  - Validates relation with `boardRelationValueSchema.safeParse`.
  - Skips items whose lifecycle state is not `'active'` (e.g. archived or in trash).
  - Renders values through the column registry (`parseValue` + `toText` with target column def) rather than inspecting raw JSON.
  - Implements all 11 aggregations: `none`, `count`, `count_filled`, `count_empty`, `percent_filled`, `sum`, `average`, `min`, `max`, `earliest`, `latest`. Numbers parsed via `numbersValueSchema` and `numericOf`.
- **Plain-text Representation:** Returns computed `displayValue`.
- **Comparator:** Alphanumeric/natural comparison on `displayValue`.
- **Supported Summaries:** `count`, `count_filled`, `count_empty`, `percent_filled`.

---

## 3. Test Coverage

Comprehensive unit tests in `packages/shared/src/columns/connect-boards-mirror.test.ts` verify:

1. `board_relation`: validation of `{boardId, itemId}` pairs, uniqueness rejection, `twoWay` superRefine constraints, `isRelationWithinSettings` checks, comparator.
2. `mirror`: rendering through column registry with canonical status and number fixtures, inactive item skipping, all 11 aggregations, and empty state fallbacks.
