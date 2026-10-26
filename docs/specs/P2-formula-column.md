# P2: Formula Column & Open-Source Engine

Author: Antigravity (Ava) · Implementer: Antigravity (Ava) · Status: In review / PR #22  
Roadmap epic: P2 "Formula column" (ID: 3306219997)

## 1. Overview & Open-Source Reuse Architecture

The Formula Column introduces an Excel- and monday.com-compatible expression evaluation engine to Atrium. Inspired by open-source formula architectures such as **Teable** (`packages/formula` + `packages/core/src/formula`, MIT) and **Baserow** (`formula/`, MIT), the engine implements a zero-dependency, pure TypeScript **Pratt (Top-Down Operator Precedence) Parser** and AST visitor architecture.

It completely avoids the heavy runtime and bundle bloat of `@formulajs/formulajs` (which pulls in `jstat` and `bessel`, ~150 KB minified) and the Java build toolchain requirements of ANTLR4, while maintaining 100% syntactic parity with `{Column Name}` formulas and monday canonical functions.

---

## 2. Key Architecture Pillars

### 2.1 Dual-Representation Architecture & Token-Span Rewriting

- **Firestore Persistence (`settings.expression`):** Formulas are stored using immutable, unique column IDs:
  `{col_budget} * (1 + {col_tax})`
- **UI Editing & Display:** Users interact with friendly, human-readable column titles:
  `{Budget} * (1 + {Tax Rate})`
- **Token-Span Reference Rewriting (`convertFormulaReferences` / `translateFormula`):**
  - References are rewritten by token spans directly on the expression string, leaving parentheses (such as `10 - (5 - 2)`), string quotes, and spacing untouched.
  - Bidirectional translation cleanly round-trips without formatting drift.
  - Renaming a column updates only the board header without breaking formulas or requiring row/column batch rewrites.

### 2.2 Virtual Client-Side Evaluation & Memory Efficiency

- Formula column values are derived in-memory on demand and are **not stored** in Firestore `item.values`. Writing computed values to Firestore would cause an $O(N)$ write explosion across all rows whenever a cell changes.
- In the board table grid, formulas evaluate virtually from the item's row values via `computeFormula(item, settings, resolver)` and can be memoized per item version (`item.updatedAt`).
- Cloud Functions reuse `@atrium/shared` (`formula.*`) on demand for automations, webhooks, or exports.

### 2.3 Dependency Graph, Cycle Detection & Lazy Evaluation

- **Cycle Detection:** `evaluateRow(columns, item)` builds a directed dependency graph of formula columns and runs cycle detection via `@atrium/shared/columns/dependency-graph` (`detectCycle` / `topologicalSort`). Circular formula references emit `#CIRCULAR!`.
- **Save-Time Validation:** `validateFormulaSettings(expression, columns, currentColumnId)` validates syntax, verifies all referenced columns exist, and rejects self-dependencies or mutual circular references before saving.
- **Lazy Evaluation:** `IF` and `SWITCH` are evaluated lazily (active branches only), ensuring expressions like `IF({q}=0, 0, 10/{q})` evaluate to `0` instead of `#DIV/0!`. `AND` and `OR` short-circuit accordingly.

### 2.4 Resource Budget & Safety Guards

To prevent ReDoS attacks and call stack exhaustion:

- Maximum expression length: 10,000 characters.
- Maximum tokens: 4,096 tokens.
- Maximum AST nesting depth: 64 levels.
- Maximum string length: 100,000 characters (guards against excessive `REPT` or concatenation).
- Bounded date arithmetic: `WORKDAY` capped to ±100,000 days.
- Timezone safety: date-only strings are parsed as UTC with deterministic UTC getters across browser and server runtimes.
- Prototype pollution protection: Object property access uses `Object.hasOwn` so properties like `{constructor}` resolve to `null`.
- Strictly safe: **No `eval()` or `new Function()`**; all evaluations run inside an AST visitor.

---

## 3. Data Shapes & Schemas

### 3.1 Settings Schema

```ts
export const formulaSettingsSchema = z
  .object({
    expression: z.string().default(''),
    outputType: z.enum(['number', 'text', 'date', 'boolean']).default('text'),
    decimalPlaces: z.number().int().min(0).max(10).optional(),
    currencySymbol: z.string().optional(),
  })
  .strict();
```

### 3.2 Value Schema

```ts
// TODO(derived): Formula column values are derived dynamically in-memory and not stored in Firestore.
export const formulaValueSchema = z.union([z.string(), z.number(), z.boolean()]).nullable();
export type FormulaValue = z.infer<typeof formulaValueSchema>;
```

---

## 4. Built-In Function Library

The engine provides monday-canonical functions alongside standard Excel/Airtable compatibility:

| Category           | Functions                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Logical**        | `IF`, `SWITCH`, `AND`, `OR`, `NOT`, `XOR`, `BLANK`, `ISERROR`                                                                                                                            |
| **Math / Numeric** | `ADD`, `MINUS`, `MULTIPLY`, `DIVIDE`, `SUM`, `AVERAGE`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `INT`, `ABS`, `SQRT`, `POWER`, `MOD`, `MAX`, `MIN`, `CEILING`, `FLOOR`                          |
| **Text**           | `CONCATENATE`, `&`, `LEFT`, `RIGHT`, `MID`, `LEN`, `TRIM`, `LOWER`, `UPPER`, `REPT`, `SUBSTITUTE`, `REPLACE`, `SEARCH`, `T`, `TEXT`                                                      |
| **Date / Time**    | `TODAY`, `NOW`, `YEAR`, `MONTH`, `DAY`, `HOUR`, `MINUTE`, `SECOND`, `DAYS`, `HOURS_DIFF`, `WORKDAYS`, `WORKDAY`, `DATETIME_DIFF`, `DATE_ADD`, `ADD_DAYS`, `SUBTRACT_DAYS`, `FORMAT_DATE` |

### Error Types

- `#DIV/0!`: Division or modulo by zero.
- `#VALUE!`: Incompatible types, unparseable date/number, or string length overflow.
- `#NAME?`: Unrecognized function name.
- `#REF!`: Deleted or nonexistent column reference.
- `#NUM!`: Math overflow (e.g. `POWER(10, 1000)`).
- `#CIRCULAR!`: Circular reference among formula columns.
- `#ERROR!`: Generic syntax or calculation error.

---

## 5. Test Coverage

Unit tests in `packages/shared/src/formula/formula.test.ts` (34 tests) cover:

- Lexer tokenization, string escape handling, column reference extraction, length guards, and unterminated string rejection.
- Operator precedence climbing, parentheses grouping, and right-associative exponentiation (`^`).
- Token-span reference conversion (`convertFormulaReferences`) preserving parentheses and quotes.
- Static return type inference (`inferReturnType`).
- Lazy evaluation of `IF` and `SWITCH`, and short-circuiting `AND`/`OR`.
- Strict and case-insensitive string equality (`=`, `!=`) and SWITCH comparison.
- Timezone-safe UTC date functions (`YEAR`, `MONTH`, `DAY`, `HOURS_DIFF`, `WORKDAYS`, `WORKDAY`, `ADD_DAYS`, `SUBTRACT_DAYS`, `FORMAT_DATE`).
- Registry-backed canonical cell resolution (`createCellResolver`, `resolveCellValue`).
- Save-time validation (`validateFormulaSettings`) and row evaluation with circular dependency trapping (`evaluateRow`).
- Typed raw computation (`computeFormulaRaw`), formatted display strings (`formatFormulaResult`), and numeric comparison in `formulaColumn.compare`.
