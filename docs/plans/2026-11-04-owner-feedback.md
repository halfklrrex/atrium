# Plan: owner feedback of 2026-11-04 (pending implementation)

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

- **First:** download the screenshot (monday asset 291448967; the public URL is valid for 1 hour) to the scratchpad and confirm which surface it is. Likeliest: the rich-text highlights (`--atrium-highlight-*` in `apps/web/src/theme/editor-tokens.css`, a 40% colour mix) in the description editor and the update composer. Other candidate: label chips on custom colours.
- **Reuse:** `getReadableButtonTextColor` in `apps/web/src/columns/button.tsx` already picks dark or light text from WCAG luminance. Move it to `apps/web/src/theme/readable-text.ts` (tests beside it) and use it for any runtime-coloured fill.
- **Token highlights:** add a paired `--atrium-highlight-<key>-text` token per colour, light and dark, in `editor-tokens.css`; apply it in `RichText.module.css` and the description editor styles. Extend `editor-tokens.test.ts` so every pair meets 4.5:1.
- **Visual QA:** light and dark against monday; rebuild the baselines if screens change.

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
