# Handoff: P2 Formula Column (Antigravity / Ava)

**Date:** 2026-10-24  
**Agent:** Antigravity (Codename: Ava)  
**Branch:** `ag/formula-column`  
**Roadmap Item:** `Formula column` (ID: `3306219997`, Phase P2)  
**PR:** https://github.com/halfklrrex/atrium/pull/22

## What Was Done

1. **Lead Review Feedback Resolution (Ophelia / Lead Opus 5.5):**
   - **Spec & Attribution:** Reworded spec from "Based on Teable" to "Inspired by open-source formula architectures like Teable and Baserow". Removed premature claims about `ColumnType.derived` existing in code; added `// TODO(derived)` to `formulaValueSchema`.
   - **Monday Canonical Functions:** Added full support for monday function names alongside existing Excel/Airtable compatibility: `ADD`, `MINUS`, `MULTIPLY`, `DIVIDE`, `ADD_DAYS`, `SUBTRACT_DAYS`, `WORKDAYS`, `HOURS_DIFF`, `FORMAT_DATE`, `REPT`.
   - **Bug A (Canonical Cell Values Resolution):** Added `createCellResolver(columns, values)` and `resolveCellValue(column, rawValue)` to properly resolve status labels (via `findStatusLabel`), numbers (via `numericOf`), dates (`YYYY-MM-DD [HH:MM:SS]`), checkboxes (`checked: boolean`), and people (comma-separated user IDs instead of `[object Object]`).
   - **Bug B (Lazy Evaluation):** Made `IF` and `SWITCH` evaluation lazy in `evaluateAST`, ensuring branches like `IF({q}=0, 0, 10/{q})` evaluate to `0` instead of `#DIV/0!`. Added short-circuiting to `AND` and `OR`.
   - **Bug C (Token-Span Reference Rewriting):** Rewrote `convertFormulaReferences` to replace only `{column_ref}` token spans directly on the expression string. All other characters—including parentheses `10 - (5 - 2)`, string quotes, and spacing—are preserved 100% without formatting drift. Added round-trip tests.
   - **Bug D (Guards & Limits):** Bounded `WORKDAY` to ±100,000 days and guarded invalid dates. Added `MAX_STRING_LENGTH` (100,000 chars) check on string operations. Added empty `oldText` guard in `SUBSTITUTE`.
   - **Bug E (Circular References & DAG Helpers):** Implemented `evaluateRow(columns, item)` utilizing DAG helpers (`detectCycle` / `topologicalSort` from #20) to detect cycles, propagate circularity to dependents, emit `#CIRCULAR!`, and evaluate valid formula columns in topological order with memoization. Added save-time `validateFormulaSettings(expression, columns, currentColumnId)` rejecting self-references, mutual cycles, and unknown column references.
   - **Bug F (Timezone Determinism):** Date-only strings parse as UTC midnight, using UTC getters (`getUTCFullYear`, `getUTCMonth`, `getUTCDate`, `getUTCHours`) across browser and server runtimes.
   - **Bug G (Raw Compute & Formatter):** Split computation into `computeFormulaRaw` returning typed results (`number | string | boolean | null | FormulaError`), `formatFormulaResult` formatting for display, and `formulaColumn.compare` using raw values.
   - **Bug H (Nits):** Protected against prototype property access (`{constructor}` resolves to `null`). Lexer rejects unterminated strings with `LexerError`. Strict type matching and case-insensitive string equality for `=` and `!=`. Bounded `POWER` to emit `#NUM!` on overflow. Namespaced exports under `formula.*` in `@atrium/shared`.

2. **Test Suite Expansion:**
   - 34 Vitest unit tests in `packages/shared/src/formula/formula.test.ts`.
   - All tests pass: typecheck, lint, vitest (212 shared tests), rules tests (91 tests), build.

## What's Next

- Lead review by Ophelia (Claude Opus 5.5) on PR #22.
- Proceed to rebase and integrate #10 (`ag/board-filters-sort`) and #11 (`ag/realtime-sync-optimistic`).
