# 2026-11-06, Ophelia: inventory of work in flight at the end of 2026-11-05

Written at the start of 2026-11-06 after finding several subagent worktrees with unfinished work. Nothing below is merged. The previous note is `2026-11-05-ophelia-p5c-p5e-live.md`.

## Open PR

- **#112** P5e-R4 Manage tab table with the "Needs attention" chip. It reports **no checks** and is **CONFLICTING** with `main` (`main` moved on with #113, the docs PR). A rebased copy exists as local branch `claude/p5e-r4-manage-tab-v2` (worktree `.claude/worktrees/agent-a01f08dd319151a04`, 2 commits on top of current `main`: the Manage table and the visual spec fix; **not pushed**). Next: push v2 (or rebase `claude/p5e-r4-manage-tab`), run the baselines workflow, push an empty commit so CI runs, merge when green.

## Unfinished work in worktrees (all uncommitted, none pushed)

All four were left mid-task when the previous session ended. Each needs: review the diff against its spec, run `pnpm lint`, `typecheck`, `test`, `test:rules`, `build`, commit, push, open a PR. Roadmap items were created for each on 2026-11-06 (Agent = Claude, Status = Building).

| Worktree (under `.claude/worktrees/`) | Branch | What it is | Size |
|---|---|---|---|
| `agent-ac239c6ee601860c2` | `claude/req-1-required-shared-rules` | REQ-1 of the Required-columns hard rule (`docs/specs/REQ-required-columns-hard-rule.md`): `requiredColumnIds`, rules, `onBoardColumnsWritten` maintenance, backfill migration, `tests/rules/src/required.test.ts` | 22 modified, 3 new files (hot spots: `firestore.rules`, `packages/shared`, `tests/rules`) |
| `handoff-1105b` | `claude/flag-emoji-fallback` | Flag emoji CDN picture fallback for Windows (owner decision 2026-11-05): new `Emoji` component, `lib/flag-emoji.ts`, uses in country column, workspace tile, rich text, emoji picker; `PROVENANCE.md` and `architecture.md` entries | 8 modified, 5 new |
| `agent-a02effe111e4df1cb` | `claude/automation-update-author` | Render the `automation:<id>` author of `post_update` updates as a named actor (`lib/automation-actor.ts`, `UserAvatar`, `UpdatesFeed`, `UpdateReplies`) | 4 modified, 4 new |
| `agent-ab3ec36636e6823bc` | `claude/p5e-templates-ready-impl` | Relabel catalog templates that P5c now covers from "Soon" to ready, with a `build()` (`starter-recipes.ts` and test) | 2 modified |

Also present: `claude/p5e-templates-ready` (`agent-abee0bf43498b61fc`), clean, same commit as `main`, an earlier spec-only attempt for the relabel; safe to remove.

Note: the REQ-1 work touches hot-spot files. Check there is no other open PR on `firestore.rules` or `packages/shared` before opening it, and merge REQ-1 before REQ-2 and REQ-3.

## Stale worktrees and branches (safe to clean up once confirmed)

- Merged PRs, can be removed with `git worktree remove`: `Atrium-wt/{dashboards-workload,forms-web,handoff-1105,p5a-engine,p5b-builder,p5b-center,p5c-spec}` and the merged-PR subagent worktrees `agent-a37aa4d2344c1503d` (R2), `agent-a55f8445414575eb2` (P5c-2), `agent-a6291bcc0ab2235fb` (R1), `agent-a820ea73867ba6d21` (R3), `agent-aa43d72aaab4357ac` (P5c-1), `agent-af139d137037867e7` (P5c-3). Some of these are `locked`; unlock first. Do not remove a worktree with uncommitted files (the four above).
- `claude/p5d-spec` exists locally and on `origin` with no PR; check whether it holds the start of the P5d (time-based triggers) spec before deleting.

## Owner decisions still pending or not started

- Required columns: three open questions have defaults (both rules, eventual revert, no bypass). Confirm or change before REQ-2.
- Site admin role (Roadmap item 3335038323): two questions to the owner, then a spec.
- Legacy-activity migration: dry run only, then ask. Not run.
- Live checks: light mode, the Activity log and the recipe run itself are unchecked (writes stay with the owner; see `docs/plans/owner-check-list.md`).

## Next, in this order

1. Start-of-session routine (bug inbox, Actionable = Agents).
2. Land #112 (see above).
3. Finish and open the four in-flight branches, REQ-1 first (hot spots).
4. REQ-2, REQ-3; P5d spec; site admin spec; VF visual QA for the new screens.
