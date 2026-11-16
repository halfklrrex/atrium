# 2026-11-16 · Ophelia · evening summary

Work was done by Sonnet coders in their own worktrees, with a separate reviewer per PR (Opus for the security-sensitive vote-integrity rules) and the lead merging with rebase after green CI.

## Merged since the morning note
- Label editor panel (#275), QA fixes (#272), SUBITEMS PR 4 and 5 (#268, #271), MCP batches 1b, 1c PR 1 and PR 2 (#264, #276, #281), vote integrity rules (#279), Files gallery PRs 1 to 3 (#277, #280, #282), specs (#274, #278), HANDOFF and decisions docs.
- Decisions D1 to D7 (OPS4) logged on the Decisions board, plus "no minInstances" and the vote-integrity residual risk (Proposed).

## Open (all on monday for the owner)
See the "Waiting on the owner" bullet in HANDOFF.md. The vote backfill must only run after the owner approves it and after a dry run.

## Gotchas for the next session
- The main checkout was left on a detached HEAD by an agent; `HANDOFF.md` there is the newest copy.
- Two monday tool pitfalls: `create_update` with `updateId` posts top-level comments (use GraphQL `parent_id` for replies); deleting comments through the API was denied by the permission system.
- One orphan Firestore emulator (port 8115) may still be running.
