# P5e: Automation center redesign (variant A, plus two pieces of variant C)

Author: Ophelia · Implementers: Sonnet 5.5 (medium effort) · Roadmap: P5 · Automations (item "Automation center redesign") · Builds on: `P5b-automations-ui.md` (the Automation center #97 and the recipe builder #100, both merged 2026-11-05) · Status: **design chosen by the owner on 2026-11-05; this spec is a first outline, to be completed before any code.**

## Decision (owner, 2026-11-05)

The owner compared three Opus-designed mockups of a more monday-like Automation center and chose **variant A ("Classic catalog")**, **plus two pieces of variant C**:

1. the **"Hide coming soon" switch** in Create, and
2. a **"Needs attention" chip** in Manage on automations that are failing or switched off by the circuit breaker.

The reference was a screenshot of monday's automation center (owner's, not in the repo; never copy monday's name, logo, icons or brand art).

## Where the mockups are

- Interactive preview with all three variants (A / B / C switcher, light and dark, with-data and empty boards): a private artifact the owner owns. Its link is on the Roadmap item, not in this public repo.
- Local copies (gitignored, in Claude's home copy only): `.private/design/automation-center/` (`variant-a.html`, `variant-b.html`, `variant-c.html`, `automation-center-options.html`, `src/`, `build.py`). Each variant is a self-contained interactive HTML mock with its own notes. **Read `variant-a.html` and the "from C" parts of `variant-c.html` before writing the full spec.**
- If the local copies are gone, re-read the artifact with the Artifact tool (`action: "read"`), or ask the owner.

## What variant A is

A large full-screen modal titled "Automations: <board name>" with a **Create | Manage** toggle at the top and the close button at the top right.

- **Create:** a left **Categories** sidebar (Explore, Recommended, Productivity, Dates, Communication, Sync, Connected & mirror columns, and so on), a **Search** field, a "Start with the basics" row (a **Create from scratch** card plus the three starter sentence cards) and a "Recommended" section. Each template card is a sentence with the key words in bold and a **Use template** button. "Create from scratch" and "Use template" open the sentence builder.
- **Manage:** a table of the board's automations with an on/off switch, last run and result, Duplicate and Delete (in-page confirm), plus a **Run history** sub-tab. Today's Recipes and Run history tabs (`RecipesTab.tsx`, `RunHistoryTab.tsx`) become these two sub-tabs almost unchanged.
- **Sentence builder:** "When [trigger] … and only if [condition] … then [action]" with inline pickers (up to 3 conditions and 5 actions, as the engine allows), replacing `RecipeBuilder`'s form layout while keeping `recipe-draft.ts` and `describe-automation.ts`.

## Honesty rules (from the design brief)

- **9 of the 19 mock templates work on today's engine.** The others are disabled and badged: **"Soon · P5c"** (more triggers and actions, `P5c-automations-more.md`), **"Planned · P5d"** (time-based triggers, dates) and **"Planned · P9"** (integrations). The "Hide coming soon" switch (from C) hides them.
- **Integrations** (Gmail, Calendar, Slack) don't exist. They show only as a disabled "Coming soon" element and placeholders, with no brand logos.
- **Left out on purpose:** the "AI-powered" category and "create with AI" (not on the roadmap), and the "Created by <workspace>" category (workspace-saved templates need a new data model).
- All sample names are fictional.

## What is new in the codebase

- A full-screen modal shell, replacing the large dialog in `AutomationCenter.tsx`.
- A **template catalog**: grow `starter-recipes.ts` from the current starters to about 19 entries, each with a category and an availability (`ready`, `p5c`, `p5d`, `p9`). Only `ready` templates can create a recipe; they go through `recipe-draft.ts` and `validateAutomation` like any recipe.
- The inline-token sentence builder.
- New tokens in `apps/web/src/theme/automation-tokens.css` (tokens only; no literals in components).
- "Needs attention" chip: derived on the client from the automation's `enabled`, `disabledReason` and its latest runs; no server change.
- Visual: the screens change, so the baselines workflow runs on each UI PR, and the showcase board (`scripts/showcase/`) keeps its two recipes.

## Open questions for the owner (not yet answered; defaults I will use unless told otherwise)

1. **Which monday features matter most** beyond A? Not answered. Default: none added; AI templates, workspace-saved templates and an account-wide "all my automations" view stay out.
2. **Coming-soon templates visible by default?** Default: **visible and badged**, with the "Hide coming soon" switch off.
3. **Full-screen modal instead of today's large dialog?** Implied by choosing A. Default: yes.
4. **Per-automation run counts stored by Functions?** Default: **no server change in v1**; drop the "Runs" column or count from the 30-day history on the client.
5. **Board-wide run history in Manage (A) or per-automation (B)?** Choosing A implies board-wide. Default: board-wide sub-tab.

Put the confirmed answers in this section before building.

## Suggested PR split (all web; no hot-spot files except the baselines)

1. **R1 shell and catalog data:** the modal shell with the Create | Manage toggle, `starter-recipes.ts` growth with categories and availability, tests.
2. **R2 Create tab:** categories sidebar, search, the card sections, "Hide coming soon", the disabled badges.
3. **R3 sentence builder:** inline tokens, reusing `recipe-draft.ts` and `describe-automation.ts`.
4. **R4 Manage tab:** the table and switches, the Run history sub-tab, the "Needs attention" chip.

Each PR: the five checks, the baselines workflow when screens change on purpose, and a light and dark comparison against the mock and the owner's reference screenshot.
