# Plan: owner feedback of 2026-11-04 (pending implementation)

> **Superseded (2026-11-04):** the open-PR limits in this plan were removed by the owner. See `AGENTS.md`.

## Context

The owner went through the Roadmap on 2026-11-04. They signed off several items, sent back two new reports through the bug inbox, and handed the P5 product decisions to the lead. PR #74 (rich text in the update composer) and #75 (HANDOFF refresh) are merged and live. **Nothing in this plan is built yet; the next session starts here.**

Follows the format of `2026-11-03-autonomous-batch.md`. Work loop (AGENTS.md / CLAUDE.md): Opus writes or checks the spec, a Sonnet subagent (medium effort) codes in its own worktree `claude/<task>` with its own `ATRIUM_PORT_OFFSET`, Opus reviews the diff and runs the five checks, then PR, baselines workflow if the UI changed, rebase merge on green CI. Limits: at most 2 open PRs, one per hot-spot file. Start-of-session routine first (sync, PRs, bug inbox, Actionable = Agents with label id 4).

## What the owner sent back

| Item                                             | Owner said                                                      | Outcome                          |
| ------------------------------------------------ | --------------------------------------------------------------- | -------------------------------- |
| Connect boards & mirror (3306234642)             | "Works correctly!"                                              | Done                             |
| Change a column's type (3309194280)              | "All good!"                                                     | Done                             |
| Saved & personal views (3306219723)              | "Fixed!"                                                        | Done                             |
| Description editor pass 3 (3311534270)           | "Perfect"                                                       | Done                             |
| Files column (3306293650)                        | Works; asks whether buttons can be configured                   | Yes, live in #65 and #72. Done   |
| Roles, permissions (3306251568)                  | Assume it works; review later with an ultrareview               | Done. See section D              |
| Automation engine design (3306251672)            | "You can make the most informed decisions"                      | Decisions in section C; Planning |
| Bug inbox 664822847                              | Dragging a favourite opens that board on release                | Section A                        |
| Bug inbox 664830810 (screenshot asset 291448967) | Text colour should adapt to the fill: black on red is illegible | Section B                        |

## A. Bug: dragging a favourite opens the board on release (small, first)

- **Cause:** in `apps/web/src/components/Sidebar/Favorites.tsx` (around lines 201-211) the dnd-kit `listeners` are spread onto the `NavLink`. After a drag (PointerSensor `distance: 6`) the browser still fires `click` on pointer-up, so `NavLink` navigates.
- **Fix:** keep a "a drag just happened" ref, set in the `DndContext` `onDragStart` and cleared on the next tick after `onDragEnd` / `onDragCancel`. In `FavoriteRow`'s `onClick`, call `preventDefault()` and skip `onNavigate` while it is set.
- **Check first:** `apps/web/src/components/Sidebar/SidebarTree.tsx` (around line 140) uses the same DndContext pattern. If it has the same bug, fix both with one small shared helper.
- **Tests:** in `Favorites.test.tsx`, a drag does not navigate and a plain click still does.

## B. Bug: readable text on coloured fills

- **Surface (confirmed from the screenshot):** the Timeline view's bars (the Calendar pills share the code). Dark text on the red "Design new pricing page" bar and on the purple "Legal review" bar.
- **Cause:** `textToneFor` in `apps/web/src/components/board-date-views/date-view-model.ts` picks dark text above luminance 0.18, the point where white text stops reaching 4.5:1. But the dark text is monday ink `#323338`, not black. The red (`#df2f4a`, luminance about 0.182) and purple (`#9d50dd`, about 0.181) sit just over the line, get dark text and reach only about 2.8:1, while white would reach about 4.5:1.
- **Fix:** choose the tone by comparing the real contrast of the two text colours (`--atrium-calendar-pill-text-dark` `#323338` and white) against the fill. The crossover is a luminance of about 0.245. Keep the helper in one place for Timeline and Calendar.
- **Tests:** in `calendar-model.test.ts` or a new `date-view-model.test.ts`, check that red and purple get light text and orange, green and yellow keep dark text, and that every Vibe status colour gets the better of the two (at least 4.5:1 wherever either reaches it).
- **Other surfaces:** a quick look for the same problem on Kanban cards, label chips and the Chart view legend. Log any other miss as its own item instead of widening this one.
- **Visual QA:** Timeline and Calendar in light and dark; rebuild the baselines if the screens change.

## C. P5 decisions and the start of P5a

The owner delegated the six questions. The answers are recorded (accepted) in section 11 of `docs/specs/P5-automations-design.md`:

1. Runs as the creator, with their permissions; skipped and disabled with a visible reason if they lose access.
2. P5a recipes: status changed to, item created, button clicked.
3. Limits: 20 automations per board, 100 runs per hour per board, depth 3, as constants in `functions/src/lib/automations/limits.ts`.
4. Create items and post updates: yes, in P5c, behind the same limits.
5. Failures always in the run history; one notification to the creator when the circuit breaker disables an automation.
6. Notification label "Automations" plus the recipe name, creator named in the detail.

Then, after A and B, write the P5a PR split from sections 3-7 of the spec, one spec-first PR each:

- shared schema
- rules and tests (hot spot, its own PR)
- extract `runActions` from `clickButtonInTransaction` in `functions/src/lib/column-actions.ts`
- `onActivityCreated` and the matcher
- recipe builder UI

Log "P5 automations: product defaults (owner delegated, 2026-11-04)" on the Decisions board as Accepted.

## D. Ultrareview checkpoints

Docs only, no code. `/code-review ultra` is triggered by the owner (Claude cannot launch it). Recommended points: now, on P4 sharing and roles (#46); before the P5a merge (a new server-side engine that writes on behalf of users); before P8 (public API). Update the Roadmap item "Plan ultrareview checkpoints" (Not started, Agent Claude) to match.

## E. Monday catch-up (needs the monday connector, which must be re-authenticated)

- Rich text in updates (3327934712): In review, Actionable Yes, with the #74 check list (toolbar, Ctrl+B / I / U, links, mentions, replies, light and dark); reply on bug-inbox update 662966287 that it is live.
- Sign-offs in the table above: Done and Actionable No, with a one-line reply each.
- New items in the Bugs group (Agent Claude, Not started, Actionable No): "Dragging a favourite opens the board on release" and "Text on coloured fills isn't always readable"; reply on each bug-inbox update with the link.
- New item "Plan ultrareview checkpoints".
- Post the section C decisions on the P5 item (Actionable No, Planning).
- Bug inbox master (3307382004): Actionable No once the replies are posted.

## Verification

- Each PR: `pnpm lint`, `typecheck`, `test`, `test:rules`, `build` green, CI green including `visual`.
- Monday: the Agents filter (label id 4) returns only items still waiting on us.
