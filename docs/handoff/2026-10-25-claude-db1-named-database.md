# 2026-10-25 · Claude · DB1 use the named Firestore database `atrium-1`

## Done

- **One constant:** `FIRESTORE_DATABASE_ID = 'atrium-1'` in `packages/shared/src/firebase-env.ts`, exported from `@atrium/shared`. `scripts/database-id.test.mjs` fails on a hard-coded id or `(default)` outside that module, on any `getFirestore` / `initializeFirestore` / `onDocument*` call that doesn't use the constant, and when `firebase.json` lists a different database.
- **Web:** `getFirestore(app, FIRESTORE_DATABASE_ID)` in `apps/web/src/lib/firebase.ts`; the emulator connection is made on that same handle.
- **Functions:** `db()` in `functions/src/lib/admin.ts` uses `getFirestore(FIRESTORE_DATABASE_ID)` (covers `bootstrapUser`, `purgeTrash` and the trigger's store); `onBoardColumnsWritten` declares `database: FIRESTORE_DATABASE_ID`.
- **`firebase.json`:** `firestore` is now an array with one entry, `database: atrium-1`.
- **Scripts:** `scripts/showcase/firestore-rest.mjs` builds its REST paths from the constant (new `database` option); the showcase seed and the derived-ids backfill gained `--database <id>` (default: the constant). Their tests use the constant.
- **Tests:** `tests/visual/src/seed.ts` uses the named database. The rules suites run against `atrium-1` (see below) and a new `tests/rules/src/database.test.ts` checks that the data lands there.
- **Docs:** `AGENTS.md`, `docs/architecture.md` section 2 and 2.1, `docs/DEPLOY.md`, `docs/showcase.md`.

## Verified locally

- `pnpm test:rules`, all suites on `atrium-1` in the emulator.
- Emulators (firestore + functions + auth) with a board written to `atrium-1`: `onBoardColumnsWritten` fired and wrote `derivedColumnIds` back into `atrium-1`. The backfill dry run reads `atrium-1`.
- `firebase deploy --only firestore --dry-run --debug` reads `databases/atrium-1` (`eur3`, backups on).

## Gotchas

- **`@firebase/rules-unit-testing` 6.0 only opens `(default)`** (its contexts use the compat SDK, which isn't multi-database). `tests/rules/src/helpers.ts` wraps each context so `firestore()` returns a modular handle on `atrium-1` with the same mock auth token, and replaces `clearFirestore()` with a call to the emulator's named-database clear endpoint. New suites should keep using `createTestEnv()`. The emulator applies the project's one rules set to every database.
- **The emulator accepts only a single-entry `firestore` array** in `firebase.json` ("does not support multiple databases yet" otherwise). Keep it to one entry.
- **Trigger region change:** the existing production trigger is `(default)`/`nam5`; the new one is `eur3`. firebase-tools deletes and re-creates the function on that change (`changedTriggerRegion`). Expect a short gap.
- **Storage rules cannot read the named database** (`firestore.get()` only reaches `(default)`); see `docs/architecture.md` section 2.1. This matters for the file-upload PR (#35).

## After the merge (Ophelia)

See `docs/DEPLOY.md`, "Right after the merge": owner signs in again (`bootstrapUser` recreates the user and workspace in `atrium-1`), then the derived-ids backfill and the showcase seed.
