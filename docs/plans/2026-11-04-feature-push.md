# Plan: feature push (2026-11-04): P5 automations, Gantt and Workload, dashboards, forms and templates

## Context

The owner wants faster progress. (1) Remove the open-PR caps, including the one-open-PR-per-hot-spot rule ("remove all limits"); pace is set by usage and the owner's availability instead. (2) Plan a multi-feature push covering all four areas the owner picked: **Automations (P5), Gantt + Workload views, Dashboards (P6), Forms + templates (P7)**. The P5 product decisions are already accepted (spec section 11). All the bug items from 2026-11-04 are merged (#77, #78).

## Step 0: rule change and housekeeping (one docs PR, `claude/lift-pr-limits`)

- **`AGENTS.md`**:
  - Multi-agent rule 1: replace the "Work-in-progress limit" block with "No limit on open PRs (owner decision, 2026-11-04). Keep PRs small and focused; rebase on `origin/main` before merging and resolve conflicts then."
  - Start-of-session step 7: drop "within your open-PR limit".
  - Rule 6 (hot spots): keep the list and "keep changes minimal, small PRs", but replace "wait for it to merge, then rebase" with "merge in order, and the later PR rebases and re-runs the checks (for the baselines: re-run the workflow, never hand-merge PNGs)".
- **`HANDOFF.md`**: one line under Current state, "No open-PR limits (owner, 2026-11-04)", and "Next" points to the new plan file.
- **`docs/WORKFLOW.md`**: same wording if it mentions the limit. Update the existing plan files (`2026-11-03…`, `2026-11-04…`) with a one-line "superseded: no PR limits" note rather than rewriting them.
- Save this plan as **`docs/plans/2026-11-04-feature-push.md`** in the same PR.
- Monday: log "No open-PR limits" on the Decisions board (Accepted). Claim each epic below (Agent, Branch, Status) when its spec starts.
- Also first: the **flaky world clock tests** (Roadmap 3328651015): raise the per-test timeout or fake the clock, as a small Sonnet PR. It makes CI reliable for everything that follows.

## Work loop (unchanged apart from the limits)

For each unit: Opus writes the spec in `docs/specs/`. A Sonnet subagent (medium effort) builds it in its own worktree `atrium-cl-wt/<task>` on `claude/<task>`, with its own `ATRIUM_PORT_OFFSET` (10–90, skipping 30). Opus reviews the diff against the spec and the five checks pass. Then: PR, the baselines workflow if the UI changed, a rebase merge on green CI, and a showcase re-seed when a board feature lands (rule 10). Several subagents run in parallel when they touch different files. Owner checks go into `docs/plans/owner-check-list.md`, and Monday items go to In review with Actionable = Yes.

## Track A: Automations (P5). Critical, biggest value

Spec work first: turn `docs/specs/P5-automations-design.md` into **`P5a-automations-backend.md`**, closing the gaps the code review found:

1. **Loop marker.** An automation's item write carries `updatedVia: 'automation:<id>'` and `automationDepth`. `diffItemActivity` / `itemActorId` (`functions/src/lib/activity.ts`) credit the automation as the actor and copy the depth into the activity `data`. Without this, the depth limit never fires.
2. **Activity schema** (`packages/shared/src/schemas/activity.ts`): add `data.depth`, `data.automationId` and an `automation_ran` kind. `actorId` already accepts `automation:<id>`.
3. **Notifications** (`schemas/notification.ts`, `lib/notifications.ts`): add an `automation` kind with `recipeName`. Allow a non-uid `actorId`, or keep `runAs` as the actor and add an explicit "don't skip the creator" flag. Add a `automation_disabled` notice for the circuit breaker.
4. **`runActions` extraction** from `clickButtonInTransaction` (`functions/src/lib/column-actions.ts`): a generic `runActions(tx, actions, ctx)` that reuses `validateButtonActions` and `buildActionsPatch`, passes `memberUids` for notify, and returns `skipped` when the item isn't active. The button path keeps its column checks, the 2-second guard and the `button_clicked` entry.
5. **Rate limit:** a counter doc in `boards/{b}/counters/automations` (hour bucket), incremented in the run transaction. Limits are constants in `functions/src/lib/automations/limits.ts` (20 per board, 100 per hour, depth 3).
6. **Indexes and TTL:** `automationRuns` gets an `expiresAt` TTL and composite indexes (`automationId`/`status` by `startedAt`) in `firestore.indexes.json`. Check the CPU-quota note (`docs/specs/BUG-deploy-cpu-quota.md`) for the new trigger.

PRs (in order):

- **A1** shared schemas: automation, run, trigger and condition types, reusing `buttonActionSchema` as the actions library.
- **A2** rules and tests: `boards/{b}/automations` writable by board owners; `automationRuns` readable by board readers, Functions-only writes. Patterned on `tests/rules/src/activity.test.ts`.
- **A3** `runActions` extraction, with no behaviour change and the button tests still green.
- **A4** the `onActivityCreated` trigger, matcher, runner, run history, limits and circuit breaker, with end-to-end tests like `tests/rules/src/button-actions.e2e.test.ts`.
- **A5** recipe builder UI. This is a sentence-style "When status changes to Done, then …" editor opened from the Automate button in `BoardHeader.tsx`, reusing `ButtonActionsEditor.tsx` for the "then" part.
- **A6** Automation center and run history: a list with on/off, last run and failures, and a per-run detail.
- **Later:** P5c (assigned, moved to group, create item, post update) and P5d (time-based triggers and recurring items): a scheduled function every 5 minutes, as in `functions/src/scheduled/`, plus a `dueAt` index field.

## Track B: Gantt and Workload views (P3)

- **Gantt** (`P3-gantt-view.md`): a new view type `gantt`, which reuses the Timeline model.
  - Shared files: add it to `viewTypeSchema` and `ganttSettings` in `packages/shared/src/schemas/view.ts`; the type allow-list and settings keys in `firestore.rules` (around lines 431–460) plus a rules test; `newViewSettings` in `view-actions.ts`; remove Gantt from `SOON_VIEWS` in `ViewTabs.tsx`; add a `ViewBody` case in `BoardPage.tsx`.
  - Render: `buildTimeline` from `board-timeline/timeline-model.ts`, plus an SVG arrow layer drawn from each bar's `(startIdx, endIdx, row)` and the lane's top row. Edges come from the dependency column (`{item_ids}` = prerequisites) and `dependency-graph.ts`.
  - Settings: the dependency column, a "highlight critical path" toggle (`topologicalSort` plus longest path), and a baseline column (a second date or timeline column, drawn as a thin bar under each bar).
  - Drag reuses `planDrag`. When the dependency is `strict`, show a warning when a bar starts before a prerequisite ends (web only, nothing auto-shifted).
  - Split into two PRs: (1) the view type and bars, (2) the arrows, baseline and critical path.
- **Workload** (`P3-workload-view.md`): a view type `workload`. Rows are the people from the board's People columns (`assigneeUidsOf` in `packages/shared/src/item-index.ts`), and columns are days or weeks on the same axis (`buildAxis`).
  - Each cell shows the number of items, or the sum of an effort Numbers column, with a capacity setting (items or points per day) and an overload colour.
  - Clicking a cell lists the items in it. It's one board only; workload across boards comes with dashboards.

## Track C: Dashboards (P6)

Spec `P6-dashboards.md`:

- **Object:** a new top-level collection `dashboards/{id}` with `workspaceId`, `folderId`, `position`, `name`, `boardIds[]` (up to 50 boards the creator can read), `widgets[]` (`{id, type, title, layout {x,y,w,h}, settings}`), `access` and `accessUids` (the same model as boards), and `state`.
  - Rules: read needs workspace membership plus the dashboard's access entry; widget data is read client-side under each board's own rules, so a viewer only sees boards they can read.
  - Rules tests are required.
- **Sidebar:** a `DashboardNode` in `data/boards.ts` `buildTree`, `SidebarTree.tsx`, `treeDnd.ts`, and "Dashboard" in `AddMenu.tsx`. Route `dashboards/:dashboardId` in `App.tsx`.
- **Data:** a generalised multi-board listener (from `useReadableBoards` and `useMyWorkItems` in `data/my-work.ts`), using `queries.activeItems` per chosen board and capped like `MY_WORK_BOARD_CAP`.
- **Widgets, first wave:**
  - Chart: reuse `buildChartModel` and `ChartSvg` per board, then merge; export the accumulator helpers from `chart-model.ts`.
  - Numbers: count, sum or average of a column.
  - Battery: status progress.
  - Table: a filtered item list across boards.
  - Workload: Track B's model across boards.
- **Layout:** a CSS grid with drag to move and resize (dnd-kit, already a dependency), animated with transform only.
- **PRs:**
  - C1: schema, rules and tests.
  - C2: sidebar, route and an empty dashboard page.
  - C3: the Numbers and Battery widgets.
  - C4: the Chart and Table widgets.
  - C5: the Workload widget and layout editing.

## Track D: Forms and templates (P7)

- **Templates** (`P7-templates.md`): this first, because it's small.
  - "Save as template" from the board menu writes `templates/{id}` (workspace-scoped: structure from `duplicateBoard` in `data/firestore.ts`, plus optional sample items).
  - "New board from template" in `AddMenu.tsx` and the new-board dialog, with a gallery that includes several built-in templates (project tracker, content calendar, bug tracker, family chores) defined in `packages/shared/src/templates/`.
  - Creating from a template goes through `createBoard`, with `derivedColumnIds` and `serverManagedColumnIds` set to `[]`, per the rules.
  - It needs rules and tests for `templates`.
- **Forms** (`P7-forms.md`): a view type `form` on a board. Its settings hold the ordered questions (column ids plus label, help text and required), the title, the description, the thank-you text and the target group.
  - Submissions go through a callable `submitForm` that writes the item with the Admin SDK, validates each answer with `columnRegistry.validateCell`, and logs activity. Item numbers come from the existing `onItemCreated` path.
  - **Access, as a reversible default** that the owner can widen later:
    - First slice: a share link that requires Google sign-in, with any account allowed (no workspace membership needed).
    - The form route `/forms/:formId` sits outside `AppShell`, but still inside a light `RequireAuth`.
    - Every submission is checked against a per-form rate limit counter.
    - Anonymous "anyone with the link" submissions come later, behind App Check. That will be the first unauthenticated surface, so it gets its own security review and the Actionable = Yes question.
  - File questions are a later slice: the file upload flow requires an existing item, so they need staged uploads.

## Suggested order and parallelism

1. Step 0 docs PR, plus the flaky test fix (parallel).
2. **Parallel wave 1:** A1→A2→A3 (shared, rules, functions), B Gantt PR 1 (view type), D Templates. These touch different files, apart from `packages/shared` and `firestore.rules`, which now merge in order with rebases.
3. **Wave 2:** A4 (engine), Gantt PR 2, Workload, C1–C2.
4. **Wave 3:** A5–A6 (builder and center UI), C3–C5, Forms.
5. **Wave 4:** P5c and P5d, anonymous forms (after the owner's go-ahead), visual QA passes for each new screen.

Showcase (`scripts/showcase/data.mjs`): add a Gantt view with dependencies, a Workload view, an automation recipe, a form view and a dashboard as each one lands.

## Owner touchpoints (Actionable = Yes, batched)

- Live check per epic, through the check list.
- **A decision before anonymous forms:** whether "anyone with the link, no sign-in" is wanted.
- An ultrareview before A4 merges, which the owner triggers (item 3331421567).

## Verification

- Each PR: `pnpm lint`, `typecheck`, `test`, `test:rules` and `build` locally, then green CI including `visual`. Run the baselines workflow when screens change on purpose.
- Rules: every new collection (`automations`, `automationRuns`, `dashboards`, `templates`, the form counters) has allow and deny tests per role.
- Functions: end-to-end tests against the emulator for `runActions`, the matcher, loop depth, the rate limit, the circuit breaker and `submitForm`.
- After each deploy: a Chrome check on https://atrium-workboards.web.app in light and dark on the showcase board, with the result in the owner check list. Monday items move to In review.
