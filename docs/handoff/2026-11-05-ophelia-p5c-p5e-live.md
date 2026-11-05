# 2026-11-05 (evening), Ophelia: P5c live, Automation center redesign R1 to R3 live

## Merged and live

- **#103** P5c spec (after a Prettier fix), **#106** the Required-columns hard-rule spec (draft).
- **P5c** (more triggers and actions): **#107** shared schemas, **#109** Functions (matcher for `item_moved` and `person_assigned`, executor for `create_item` and `post_update`, nine new e2e tests), **#108** web builder rows, describe sentences, and two showcase recipes.
- **P5e Automation center redesign** (variant A plus the "Hide coming soon" switch and the "Needs attention" chip): **#105** R1 full-screen shell and the template catalog, **#110** R2 Create tab, **#111** R3 inline sentence builder.
- The showcase was re-seeded on production after the P5c deploy (80 documents, 4 recipes on the main board).

## Open

- **#112** R4 Manage table with the "Needs attention" chip. Its visual spec was fixed (the recipes are a table now, not a list) and the baselines workflow was re-run. Merge when CI is green.

## What the owner decided today (answered in the session)

- **Required columns: hard rule.** Spec: `docs/specs/REQ-required-columns-hard-rule.md` (three open questions with defaults; three PRs).
- **Flag emoji on Windows: CDN picture fallback** (Twemoji or similar). Needs a licence entry; not started.
- **Legacy-activity migration: dry run only**, then ask before a real run. Not run yet.
- **Live checks:** the agent checks what it can read-only in Chrome; writes and the two-account notify check stay with the owner.
- **Bug inbox feature request:** a site admin role with account approval and blocking, Roadmap item 3335038323, two questions put to the owner on the item. Needs a spec after the answers.

## Live check done (read-only, Claude in Chrome now connects)

The showcase board, the Automate dialog (full-screen, Create and Manage), the Create tab and the four recipes render in dark mode. Not checked: light mode, the Activity log, and the recipe run itself (it writes data: set an item to Done and look at Run history).

## Next

1. Merge #112 when green; then the VF visual QA for the Automation center against the owner's reference (light and dark), and the follow-ups below.
2. **Follow-ups found in review:** some catalog templates are badged "Soon · P5c" although P5c now covers them (for example "item moves to a group, set status"); relabel them to `ready` with a `build()`. The catalog has 20 entries, not 19 (one added for "Connected & mirror columns"). Actions in the sentence builder are still bordered cards, not inline tokens. The `post_update` author id is `automation:<id>`; check how the item card renders it.
3. **Required columns:** answer the three questions on the spec, then REQ-1 (shared and rules), REQ-2 (Functions), REQ-3 (web).
4. **Site admin role:** wait for the owner's answers on item 3335038323, then spec it.
5. P5d (time-based triggers) needs a spec. Flag emoji CDN fallback. Legacy-activity migration dry run.
6. Plan: `docs/plans/2026-11-04-feature-push.md` (Track C forms follow-ups and visual QA passes remain).

## Gotchas

- **The baselines workflow can fail for a real reason:** when a screen's structure changes, a visual spec that finds elements by role must change too (R4: list to table). Check the failure log, not just the image diffs.
- **The `visual` job has a flaky dark "description slash menu" screenshot.** Re-run the failed job.
- **A baselines run that pushes no commit means no committed screen changed** (R2).
- **Stacked and parallel PRs:** merge in the order hot spots need (shared, then functions, then web); a rebase-merge was clean each time here.
- **Subagent worktrees** from today live under `.claude/worktrees/agent-*` and `Atrium-wt/`; remove them with `git worktree remove` when nothing needs them.
