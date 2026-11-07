# 2026-11-07 (day), Ophelia: builder pickers, bulk edit v2, approval ON, PWA spec

## Merged and live

- **Builder pickers (#154, replaces #151):** value blanks and token lists open above the Automation center modal (`--atrium-z-modal-popup`, `PopupLayer` context read by `AnchoredPopup` and `Popover`), token lists render through `AnchoredPopup`, Escape inside an editor no longer closes the center, empty lists say so, `highlightId` after save. Checked live in Chrome (set Status to Done in a from-scratch draft, cancelled). Not done: Manage sentence chips via `describeAutomationParts`. Spec: `docs/specs/P5e-builder-pickers-fix.md`.
- **Bulk edit v2 (#153, with review fixes):** shift+click range select (across groups, collapsed groups skipped, level-bound), immediate bulk apply with no popup, "Updating N" then "Updated N items" with one Undo, partial-failure wording for batches over 400 rows (not atomic). Range select checked live (9 rows across two groups); an actual bulk apply was NOT run on the owner's data. Spec: v2 section of `docs/specs/P1-bulk-edit-selected.md`. Reference frames from the owner's videos were extracted with ffmpeg (installed via Homebrew) into the session scratchpad only.
- **Account approval ON (#152):** `functions/.env.atrium-board` (committed, non-secret, allow-listed by `scripts/functions-env.test.mjs`) sets `ACCOUNT_APPROVAL_REQUIRED=true`; verified on the deployed `bootstrapUser`. Backfill dry run first: 1 scanned, 0 to change. Rollback: a PR setting it to `false`. **The owner's second-account test is pending** (monday site-admin item, Actionable = Yes).
- **Lint fix (#150):** the previous handoff note was not Prettier-formatted, which failed CI lint and the Deploy workflow on `main`. Run `pnpm exec prettier --write` on any doc you add.
- **PWA and web push spec (#149):** `docs/specs/P4-pwa-web-push.md`, merged as a spec only (merged before the owner's review by mistake; amend by PR if the owner changes decisions). Five questions with defaults are on the monday item (Planning, Actionable = Yes). No code.

## Process notes

- Force-push is blocked: a conflicted PR is replaced by a new branch with cherry-picked commits (#151 to #154). A rebase merge on GitHub replays an old-base branch fine when there are no conflicts (#153).
- Sonnet subagents built everything; separate Sonnet reviewers found real defects each time (hanging loading toast, Escape closing the whole modal). Keep doing review before merge.
- The visual job can flake on one screenshot (`item-slash-menu-dark`); re-run the failed job.
- Chrome: two browsers were connected (Windows and macOS); the Windows one was used. Window is small (1568x579).

## Open

- Owner checks (Actionable = Yes): approval second-account test; builder pickers (other blanks); bulk edit and shift+click on the showcase; PWA questions; the earlier checks in `docs/plans/owner-check-list.md`.
- Not yet verified by me in Chrome: the P5 items with no owner reply (time-based, event triggers, actions library, post_update author, catalog relabel). Do read-only checks, then ask the owner to sign off.
- Production backfills awaiting the owner's go: `requiredColumnIds` (8 boards), legacy-activity cleanup (1 doc). `dateKeys` is applied.
- Follow-ups: Manage sentence chips, light-mode QA of the Automation center, Export/Convert in the batch bar, print styles and `.xlsx` for Export, Vibe nested layers inside value editors (date picker) unverified above the modal, PWA-1 to PWA-4 after the owner answers.
