# 2026-10-31 (afternoon): Ophelia: P4b board sharing and the owner's feedback round

Follows `2026-10-31-ophelia-ava-queue-and-p3.md`. Sonnet subagents coded, Opus specced, reviewed and merged.

## Merged and deployed

- **#46 P4b board sharing.** `setBoardAccess`, `setBoardKind`, `leaveBoard` callables; Share dialog (replaces the old board-permissions dialog); Leave board; header Invite count. **Rules change:** `access`, `accessUids` and `kind` are no longer client-writable, even by an owner (the spec said "no change", but the old rules allowed it). Spec: `docs/specs/P4b-board-sharing.md`.
- **#47 Saved views.** The first "Save to this view" on the Main table was denied: `views/main` has no document until first saved, and the read rule evaluated `resource.data` on a missing doc. The rule now allows `resource == null`.
- **#48 Change column type.** `MANAGED_SOURCE_TARGETS` in `packages/shared/src/columns/convert.ts` gives derived and server-managed sources sensible targets; new text parsers for location, country, hour and world_clock.
- **#49 Polish.** Time tracked cell ticks each second (`useLiveNow`), Add column / Change type lists are alphabetical (`ADD_COLUMN_ORDER` is derived from `ADD_COLUMN_TYPES`), multi-word @mention search, Mirror settings empty state.

## Waiting on the owner (Roadmap, Actionable = Yes)

- Live checks: sharing with two accounts, saved view save, converting a Progress or Formula column, timer, Mirror, description mentions.
- **Decision:** what a Button should do first. Recommended: set another column to a value, then send a notification. Then Ophelia writes the spec.
- Workspace invites (P4a) stay postponed.

## Next

- Button action spec once the owner answers.
- Log the Decisions-board entries (list in the previous note, plus: board access is written only by callables).
- Possible follow-ups: the save-view error toast hides the real error code (only `console.warn` shows it); Vibe `Dropdown` has no per-option disabled state, so roles above a member's workspace cap are simply not offered in the Share dialog.

## Gotchas

- A new worktree has no `node_modules`; run `pnpm install --frozen-lockfile --prefer-offline`.
- `pnpm test:rules` inside a combined shell command may not exit; run it on its own.
- The baselines workflow commits with the Actions token, which doesn't trigger CI; the workflow's own dispatch run on that commit is the green check to wait for.
- The auto-mode classifier denies `rm` of the stale untracked draft spec in the home copy, which breaks `git merge --ff-only` there. Delete `docs/specs/P4b-board-sharing.md` in `atrium-cl` by hand, then fast-forward `main`.
- Subagents re-send their final report when a background process of theirs is still running; stop them with TaskStop.
