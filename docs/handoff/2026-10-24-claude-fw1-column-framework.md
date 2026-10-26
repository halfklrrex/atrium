# 2026-10-24 · Claude · FW1 column framework (derived columns, `validateValue`)

## Done

- **Spec:** `docs/specs/FW1-derived-columns-validate-value.md`. The design is in `docs/architecture.md` section 6.2.
- **Shared:**
  - `ColumnType` gained `derived`, `compute` and `validateValue`, plus `ColumnContext` and `ValidationResult`.
  - The registry gained `isDerived`, `computeValue`, `validateCell` and `derivedColumnIds`.
  - Registration throws for a derived type without `compute`.
  - `nextDerivedColumnIds` and `computeDerivedColumnIds` live in `packages/shared/src/derived-ids.ts`, shared by the Function and the migration.
  - `boardSchema` has `derivedColumnIds` (default `[]`).
- **Web:** `setCell` validates before writing and toasts the refusal. Derived cells render `computeValue` read-only. New and duplicated items drop derived ids. New boards carry `derivedColumnIds: []`. See `apps/web/src/components/board-table/derived.ts`.
- **Rules:** board create needs `derivedColumnIds == []`, clients can never change it, items can't write derived keys on create or update, legacy boards read as `[]`. Tests: `tests/rules/src/derived.test.ts`.
- **Function:** `onBoardColumnsWritten` (`functions/src/triggers/`) keeps `derivedColumnIds` in step. Logic and tests: `functions/src/lib/derived-column-ids*.ts`.
- **Migration:** `scripts/migrations/2026-10-backfill-derived-column-ids.mjs` (dry run unless `--apply`). Checked end to end against the emulator.
- **Deploy:** `docs/DEPLOY.md` has the owner's Eventarc setup under "Roles to add later".

## Next

- Convert #13's computed types (`progress`, `auto_number`, `item_id`, `creation_log`, `last_updated`) to `derived: true` with `compute`, and write their web cells. Then re-run the backfill, because the function only reacts to board writes.
- Make search, sort and footer summaries use `computeValue` for derived columns (they read `values.<id>` today).
- A CSV or paste import must call `columnRegistry.validateCell` per cell.

## Gotchas

- `derivedColumnIds` covers `subitemColumns` too, because sub-items share the `items` collection.
- The Function's trigger is in `eur3` (the database location) and the function runs in `europe-west1`. firebase-tools sets this itself.
- `firebase deploy` tries to grant the Eventarc project roles itself on the first event-triggered function, but `github-deployer` can't set project IAM. The owner must pre-grant them (see `docs/DEPLOY.md`).
- Under `tsx`, a `.ts` file in `functions/` loads as CommonJS and gets its own copy of `@atrium/shared`, separate from the one an `.mjs` script imports. That's why the shared computation lives in `packages/shared`, not in `functions/`.
