# FW2: Server-managed columns (not client-writable)

Author: Ophelia (lead) · Implementer: Sonnet 5.5 (high) · Branch `claude/fw2-server-managed-columns` · Worktree `ATRIUM_PORT_OFFSET=30`

Decision (Decisions board, 2026-10-25): some column types are written **only by Cloud Functions**, through the Admin SDK, which bypasses rules:

- **`time_tracking`:** start and stop through a callable, with server time and uid (Ava's #34).
- **`files`:** upload and delete through callables that write trusted metadata (#35).
- **`button`:** no stored value; clicks append to `activity` through a callable (#34).

Today any board editor can write these `values.<colId>` cells directly, so the callables' guarantees are only advisory. FW2 closes that gap with **the same mechanism as FW1's `derivedColumnIds`**. Read `docs/architecture.md` §6.2 and the FW1 code (`packages/shared/src/derived-ids.ts`, `functions/src/triggers/onBoardColumnsWritten.ts` or wherever it lives, and the `firestore.rules` `derivedIds()` helper).

## Build

1. **`ColumnType.serverManaged?: boolean`** (`types.ts`). Registry: `isServerManaged(type)`.
   - `registry.validateCell(def, value)` rejects client values for server-managed types with "This column is updated by Atrium automatically" (derived types keep their message).
   - Add a pure helper `serverManagedColumnIds(columns)` next to `derivedColumnIds`.
   - Set `serverManaged: true` on the **`time_tracking`, `files` and `button`** modules on main, if they exist on main when you start. Check which are merged: `button` (#25) is; `files` (#26) may be merging now; `time_tracking` (#24) isn't yet. Flag the ones present. For missing ones, document in the spec that the owning PR must set the flag.
2. **Board field `serverManagedColumnIds: string[]`.**
   - It's maintained by the **same** `onBoardColumnsWritten` function, which computes both lists. It writes only if either changed, in the same transaction, idempotently.
   - Board create requires `serverManagedColumnIds == []`. Clients can never change it (protected key, like `derivedColumnIds`).
3. **Rules:** item create and update refuse any key in `derivedIds()` **or** `serverManagedIds()`. Reuse the same cached board `get()`, defaulting to `[]` for legacy boards.
   - **Important:** keep it **one** board `get()` per evaluation; restructure the helpers if needed.
   - **Also:** clients can't read, create, update or delete `boards/{id}/activity/**`, which stays Functions-only (§5.6). Make that explicit in the rules, with tests, if it isn't already.
4. **Client:**
   - Server-managed cells never open the generic editor.
   - The time-tracking and files cells will call the callables from #34 and #35 once those land. For now, render them read-only, with a tooltip saying "Managed by Atrium".
   - `item-writes` refuses them (through `validateCell`), and duplicating items drops their values.
5. **Migration:** extend `scripts/migrations/2026-10-backfill-derived-column-ids.mjs`, or add a sibling script, to also backfill `serverManagedColumnIds`. Dry run by default.
6. **Tests:**
   - registry unit tests
   - the function's recompute for both lists ("no write when unchanged")
   - **rules tests:** an editor can't write a server-managed cell on create or update; normal cells still work; the field is protected; legacy boards work; the activity subcollection is denied for clients
7. **Docs:**
   - `docs/architecture.md` §6.2: add server-managed columns to the model.
   - `AGENTS.md`: one line next to the FW1 bullet.
   - **Comment on PRs #24, #26, #34 and #35** (as "Ophelia (lead)") after your PR is open, explaining that they must set `serverManaged: true`, or rebase on FW2 once it merges.

## Constraints

- Work only in your worktree, on `claude/fw2-server-managed-columns` created from `origin/main`. Push early and often.
- Additive and minimal. Don't edit Ava's open branches.
- No new IAM: this reuses the FW1 trigger.
- No deploys or merges.

## Done

- `pnpm lint`, `typecheck`, `test`, `test:rules` and `build` pass, and CI is green.
- A PR is open. End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, and end the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Report:** the PR URL, the rules diff summary and tests, which types are flagged, and the migration command.

## Implementation status (flags)

- **Flagged on main by FW2:** `button` (#25, merged).
- **Not on main when FW2 was written, so the owning PR must set `serverManaged: true` on its module** (or rebase on FW2 and add it), and re-run the backfill after deploy:
  - `time_tracking` (#24, with the callables in #34)
  - `files` (#26, with the callables in #35)
- Until a type is flagged, its cells are protected only by the callables, not by the rules.
