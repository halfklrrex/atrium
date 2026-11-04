# 2026-11-04, Ophelia: feature push (usage limit reached mid-batch)

Plan: `docs/plans/2026-11-04-feature-push.md`. PR limits are gone (AGENTS.md).

## Merged and live

Favourite-drag fix (#78), readable Timeline text (#77), flaky world clock test (#80), P5a A1 schemas/rules (#84), A2 runActions + loop marker (#81, #82), templates data (#85), Gantt view G1 (#83), dashboards data C1 (#89 if its merge job succeeded; check).

## Open PRs / branches (check `gh pr list`)

- **#90 P5a engine (A3):** built, NOT merged. Held for the owner's choice: `/code-review ultra 90` first, or merge once CI is green.
- **#87 templates UI (T2):** the visual test for the gallery failed in the baselines run (hidden Vibe radio); a subagent was fixing it and re-running baselines. Needs baselines landed, an empty commit to trigger CI, then merge.
- **Workload W1** (`claude/workload-view`) and **Gantt G2** (`claude/gantt-baseline`): subagents were still building; each opens its own PR and runs the baselines workflow (bot commits don't trigger CI: push an empty commit).
- #86: dashboards and Workload specs (docs).

## Next

1. Merge in order as CI is green; hot-spot PRs rebase first.
2. Dashboards C2 (sidebar, route, dialog, Numbers and Battery widgets) per `docs/specs/P6-dashboards.md`.
3. Write P5b spec (recipe builder, Automation center), then forms spec (`P7-forms.md`).
4. Monday: set merged items to In review with Actionable Yes plus a check-list entry for each (Gantt, templates, Workload, dashboards).
5. Owner checks live: #77, #78 (drag in a real browser).

## Gotchas

Subagents that finish with background work re-send their report repeatedly: stop them with TaskStop. Each concurrent worktree needs its own ATRIUM_PORT_OFFSET. The baselines workflow's commit doesn't run CI.
