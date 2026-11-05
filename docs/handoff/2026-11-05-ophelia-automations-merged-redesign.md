# 2026-11-05, Ophelia: automations and dashboards merged, Automation center redesign chosen

## Merged and live today

Rebased each one onto `main`, re-ran CI, then rebase-merged:

- **#102** dashboards C4/C5: Workload widget, dashboard sharing, trash.
- **#97** Automation center (Recipes, Run history, data layer, `describeAutomation`).
- **#90** the automations engine (`onActivityCreated`, runner, limits, circuit breaker). Reviewed with `/code-review ultra 90` first; all seven findings were fixed before the merge:
  - transient Firestore errors are rethrown for the trigger retry instead of recorded as failed runs;
  - label-only status cells (`{ label }`) now match;
  - invalid enabled recipes are kept and recorded (cap applies to valid ones);
  - recipes must have 1 to 5 actions and at most 3 conditions;
  - run docs carry `delivered`, and a retry re-sends pending notifications;
  - the workspace doc is read once per run;
  - one shared notify-delivery helper.
- **#100** recipe builder and starter recipes. It was stacked on #97; after #97's rebase-merge it was moved with `git rebase --onto origin/main <last #97 commit>` and the baselines workflow added the Automation center screens.
- Deploys for all of them succeeded. **Automations can now be built from the Automate button and fire for real.**

## Open

- **#103** (docs): `docs/specs/P5c-automations-more.md` (triggers "item moved" and "person assigned", actions "create item" and "post update"). CI was pending when this note was written; merge when green.
- **This docs PR** (`claude/handoff-2026-11-05`): the P5e spec, this note, HANDOFF and the check list.

## Showcase

Re-seeded on production on 2026-11-05 (78 documents written, 0 deleted): the dashboard with the Workload widget, the two automation recipes and the Form view are there. This Mac now has `gcloud` (`brew install --cask gcloud-cli`, then `gcloud auth login` with the owner's Google account and `gcloud config set project atrium-board`), so `pnpm showcase --project atrium-board --workspace <id> --owner <uid> [--yes]` works here. The ids are in `.private/project-ids.md`.

## The owner's live check is not done

Claude in Chrome never connected to the session (no `mcp__claude-in-chrome__*` tools were offered, even after `/chrome`; tools only register at session start). Nothing was verified in a browser. The five-step check: create a recipe on the showcase board ("When Status changes to Done, then notify me"), set one item to Done, open the run history (expect an `ok` run and a bell notification), and check light and dark. Do this first if the extension is connected in the new session; otherwise the owner does it from `docs/plans/owner-check-list.md`.

## Decision: Automation center redesign

The owner asked for Opus-designed alternatives modelled on monday's automation center and chose **variant A plus two pieces of C** ("Hide coming soon" switch, "Needs attention" chip). Outline and open questions: `docs/specs/P5e-automation-center-redesign.md`. Local mockups: `.private/design/automation-center/` (gitignored). The preview artifact's link is on the Roadmap item.

## Next, in this order

1. Start-of-session routine (sync, PRs, bug inbox, Actionable = Agents).
2. Merge #103 and this docs PR when green.
3. The live check above.
4. Finish the P5e spec: read `variant-a.html` and the "from C" parts of `variant-c.html`, put the owner's answers to the five open questions in the spec (defaults are listed there), then dispatch R1 to R4 to Sonnet subagents.
5. P5c per its spec (three PRs: shared, functions, web). P5d needs its own spec.
6. Visual QA passes (VF) for Gantt, Workload, dashboards, forms and the automation UI.
7. Open follow-up: "Dashboard sharing: server-side check (workspace membership and role cap)" on the Roadmap.

## Gotchas

- **Local tests:** 5 web tests (`files`, `timeline`, `week`) fail only because of the machine's locale. Run `LC_ALL=en_US.UTF-8 pnpm test` and they pass. `pnpm test:rules` needs Java: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH`.
- **Stacked PRs:** a rebase-merge gives the merged commits new SHAs, so the next PR in the stack shows as conflicting. Rebase it with `--onto`, not a plain rebase.
- **Bot commits don't trigger CI:** after the baselines workflow, push an empty commit.
- **Permission classifier:** the first attempt to have a subagent force-push `claude/p5a-engine` was refused; it worked once the owner explicitly approved the force-push.
- **Subagents that stop with background work re-send their report:** stop them with `TaskStop` if they loop.
- **Worktrees in use:** `Atrium-wt/{dashboards-workload,forms-web,p5b-builder,p5b-center,p5a-engine,p5c-spec,handoff-1105}`. Their PRs are merged, so they can be removed with `git worktree remove` once nothing else needs them.
