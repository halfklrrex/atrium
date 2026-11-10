# 2026-11-10 · Ophelia · Settings layout A, sidebar Overview tab, MCP priority 1, showcase ids

## What happened

- **Merged and live:** #222 (loader centring; on phones the table view's title row and view tabs scroll away, other views still pin), #223 (MCP `atrium_get_item_description` and `atrium_set_item_description`), #224 and #226 (specs), #225 and #227 (Settings layout A PRs 1 and 2: grouped nav, centred cards, identity card, theme previews, bell and push matrix), #228 (dash-free showcase ids).
- **Design process that worked:** Opus designers produced HTML previews (published as artifacts), the owner picked, Opus wrote the spec, Sonnet built in a worktree, baselines via the workflow. For the sidebar the owner chose the A + C hybrid with B's key information bar (Status, Owner, Due, Priority) after a Fable designer drew it. Previews live only in the session scratchpad; the spec records the decisions.
- **Showcase bug (owner report):** the readable-URL parser takes the id after the last `-`, so showcase ids with dashes (`showcase-main`) 404ed. Ids are now dash-free; the seeder deletes the legacy dashed docs. **Production has not been re-seeded yet** (needs the owner's approval; dry run first).
- **Column-lock gap fixed in the sidebar PR:** `ItemView` built its `TableCtx` without `board`/`boardRole`, so cells ignored column locks. The shared `use-item-ctx` hook fixes both views. Rules were not checked for the same gap.

## Next

1. Merge sidebar PR 1 (#229) once CI is green; then PR 2 (description clamp, toolbar-on-focus, subitems row, latest-update teaser, write-an-update line) and PR 3 (Files tab; there is none today).
2. MCP priority 1 (Roadmap 3346811892): updates (read, post, reply, edit, delete), subitems (list, create, update, description), structure discovery. Merge, then tell the owner to `git pull` and restart Claude Code.
3. Settings PR 3: the phone drill-in (`/settings` index, back buttons).
4. Subitems: same column structure as items (bug 3346811825), full-item behaviour and opening a subitem's page (3346809308). Ask the owner which screen overlaps (their screenshot is behind monday's login).
5. Run the showcase seeder on production after the owner agrees.

## Gotchas

- The baseline workflow's commit does not start CI: push an empty commit to the branch. Visual baselines for new screens come only from the workflow.
- Visual tests click rows by the seeded **item name** (for example "CI/CD pipeline 3"), not words in the seeded description.
- Seed helpers that change board columns make the Functions emulator log activity entries that leak into later screens; clear activity afterwards.
- Showcase and test seed ids used in URLs must be dash-free.
- monday image attachments are not readable from here; ask for a description.
- This Mac has no Java on the default path: `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH` for emulators and rules tests; subagents without it cannot run the visual specs locally.
