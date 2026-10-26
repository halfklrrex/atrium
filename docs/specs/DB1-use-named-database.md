# DB1: Use the named Firestore database `atrium-1` (eur3)

Author: Ophelia (lead) · Implementer: Sonnet 5.5 (high) · Branch `claude/db1-named-database` · Worktree `ATRIUM_PORT_OFFSET=50` · **Priority: urgent**

## Context

The owner created a named Firestore database, **`atrium-1`**, located in **`eur3`** (Europe), with scheduled backups enabled. Atrium was mistakenly wired to the project's `(default)` database, which is in `nam5` (US). The `(default)` database holds only disposable test data. **Switch everything to `atrium-1`.** Leave `(default)` untouched; the owner decides later what to do with it.

## Build

1. **A single source of truth:** `packages/shared/src/firebase-env.ts` (or similar) exports `FIRESTORE_DATABASE_ID = 'atrium-1'`. Every consumer imports it; no string literals elsewhere. Add a unit test or grep check that fails if `'(default)'` or a hard-coded database id appears outside that module, except in tests that deliberately cover it.
2. **Web:** `apps/web/src/lib/firebase.ts` uses `getFirestore(app, FIRESTORE_DATABASE_ID)` (or `initializeFirestore(app, settings, FIRESTORE_DATABASE_ID)`). The emulator connection must target the same database id; the Firestore emulator supports named databases. Check every `getFirestore()` call in the app.
3. **Functions:**
   - The admin init uses `getFirestore(FIRESTORE_DATABASE_ID)` from `firebase-admin/firestore`.
   - **Firestore triggers** (`onBoardColumnsWritten`, and any others) must declare `database: FIRESTORE_DATABASE_ID` in their `onDocumentWritten({...})` options, or they won't fire for `atrium-1`.
   - `purgeTrash`, `bootstrapUser` and anything else using the Firestore admin client must point at `atrium-1`.
   - Check that the Eventarc trigger for a named eur3 database deploys from functions in `europe-west1`: what region does firebase-tools give the trigger? Document it.
4. **`firebase.json`:** convert `firestore` to the array form, `[{ "database": "atrium-1", "rules": "firestore.rules", "indexes": "firestore.indexes.json" }]`, so `firebase deploy` releases rules and indexes to `atrium-1`. Confirm with `firebase deploy --only firestore --dry-run` if supported, or by reading the firebase-tools 15.34 source and docs. Keep the emulators working: `pnpm dev` and `pnpm test:rules` must use `atrium-1` in the emulator.
5. **Rules tests** (`tests/rules`): `@firebase/rules-unit-testing` should test against the named database if the library supports it. If it doesn't, document that the rules file is identical and the tests run against the emulator's default.
6. **Scripts:**
   - `scripts/showcase/firestore-rest.mjs` and the migration scripts build REST paths `projects/<p>/databases/<id>/documents`. Use `FIRESTORE_DATABASE_ID` (or a `--database` flag defaulting to it).
   - The visual-test seed (`tests/visual/src/seed.ts`) and any `firebase-admin` usage in tests must target the same id.
7. **Storage rules cross-service limitation (research and report; don't implement):** can `storage.rules` `firestore.get()` / `firestore.exists()` read a **named** database (`/databases/atrium-1/documents/...`)? Check the current Firebase docs and the firebase-tools or rules runtime. Report clearly whether it works, with sources. This decides the design for Ava's file-upload PR #35. Don't change `storage.rules` beyond what's needed.
8. **Docs:**
   - `AGENTS.md`'s project facts: Firestore is the named database `atrium-1` (`eur3`) with scheduled backups; `(default)` (`nam5`) is unused legacy.
   - `docs/architecture.md` §2.
   - `docs/DEPLOY.md`.
   - `docs/showcase.md`.
   - A handoff note.

## After merge (Ophelia does this, not you)

The deploy releases the rules and indexes to `atrium-1` and the functions pointed at it. Then Ophelia re-runs the derived-ids backfill and the showcase seed against `atrium-1`; the owner signs in again, and `bootstrapUser` recreates the user and workspace there. Make sure the scripts make that straightforward, and list the exact commands in the PR.

## Constraints

- Work only in your worktree, on `claude/db1-named-database` created from `origin/main`. Push early and often.
- Other agents are working on FW2 (server-managed columns: `onBoardColumnsWritten`, `firestore.rules`) and a menu z-index fix. Keep your diff focused on the database id, and expect to merge `origin/main` before the PR.
- No deploys, no gcloud or firebase writes, no merges.

## Done

- `pnpm lint`, `typecheck`, `test`, `test:rules` and `build` pass, plus CI `verify` and `visual`.
- A PR is open. End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, and end the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Report:** the PR URL, every place changed, the trigger region finding, the Storage cross-service finding (with sources), and the post-merge commands.
