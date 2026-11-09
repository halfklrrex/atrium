# WS-icons: Material Symbols icons for workspaces (2026-11-09)

Owner decisions: workspace icons can come from an icon set; the owner chose **Material Symbols** (outlined) after the preview page (monday item 3340735612); emoji and letters stay available as options. Folders and boards: the owner said yes to icons for them too, but folders have no icon field today and boards have a reserved `icon: null`; that is a later item (add a field and rules), not part of this PR.

Licence: Material Symbols is Apache-2.0, compatible with AGPL-3.0-only. Follow `docs/PROVENANCE.md` and the licensing rules in `AGENTS.md`: register the copy (upstream, version, paths, changes, date, agent), keep the Apache-2.0 notice in `THIRD_PARTY_NOTICES.md`, and run `pnpm licenses:notices` / `pnpm licenses:check` if any dependency changes.

## Design

**Stored value.** `workspaces/{id}.icon` stays a string. Two forms:

- legacy: 1 to 8 characters (a letter or an emoji), as today, unchanged;
- new: `mi:<key>` where `<key>` matches `^[a-z0-9_]{1,40}$` (a Material Symbols name such as `home`, `diversity_3`).

Keep the stored form short and self-describing so nothing breaks on rollback. Raise the rules and schema maximum from 8 to 48 characters for workspaces only (`iconSchema` is also used by dashboards and boards: add a separate `workspaceIconSchema` and leave `iconSchema` alone).

**Curated set, not the whole font.** Ship about 150 to 200 outlined icons as per-icon SVG path data in one generated TypeScript module in `apps/web/src/` (for example `components/workspace-icons/icons.generated.ts`: `{ key, label, keywords, path }`), produced by a script `scripts/generate-workspace-icons.mjs` that reads `@material-symbols/svg-400` (a devDependency, or run from a temporary install: choose the lighter way and document it) and writes the module deterministically. Do not import the full package at runtime, and keep the generated module under about 100 KB. Groups for the picker: People and home, Work and money, School and learning, Health and food, Travel and transport, Nature and animals, Tools and tech, Fun and hobbies, Symbols (stars, hearts, rocket, bulb, flag).

Use the same curated names for every workspace-style meaning the preview page covered: home, family (use `diversity_3` or `groups`, **not** `family_restroom`, which looks like a restroom sign), travel, money, school, health (not `health_and_safety`: use `favorite` or `monitor_heart`), garden, car, project, book, star, heart, briefcase (`work`), rocket (`rocket_launch`), lightbulb, calendar, folder, camera, music, shopping cart, utensils (`restaurant`), pets, tools (`build`), globe (`public`).

**Rendering.** `WorkspaceTile` renders `mi:<key>` as an inline `<svg viewBox="0 -960 960 960" fill="currentColor">` sized relative to the tile (about 62%) in the tile's text colour; unknown keys fall back to the first letter of the workspace name so a removed icon never breaks the UI. Legacy letters and emoji render as before. `aria-hidden` stays. Every place that shows a workspace tile uses `WorkspaceTile`, so check the sidebar switcher, workspaces page, search results, home, invite page and the members dialog.

**Picker.** In the workspace dialogs (`apps/web/src/components/dialogs/WorkspaceDialogs.tsx`: "Add workspace" and workspace settings) the icon control becomes three tabs or one popover with a search box: **Icons** (grouped grid, searchable by label and keywords), **Emoji** (the current emoji behaviour), **Letter** (the automatic first letter, the default). Match monday's picker feel with Vibe components, tokens only, keyboard accessible (arrow keys in the grid, visible focus), and a working phone layout (the mobile pass is under way: no overflow at 375 px).

**Server and rules.** `firestore.rules`: the workspace `icon` size limit becomes 48 (create and update) and, for `mi:` values, must match `^mi:[a-z0-9_]{1,40}$` (`matches`), while the legacy form keeps its 1 to 8 limit. Rules tests for: legacy letter and emoji accepted, `mi:home` accepted, `mi:` with uppercase or spaces or 41+ characters refused, a 49-character string refused, a non-string refused. Do not change any other rule. Check `functions/` for any code that copies or validates the workspace icon (bootstrap creates a personal workspace with a letter icon, keep that) and the showcase seed and MCP connector, and update their types if needed.

**Showcase and docs.** Give a showcase workspace an icon from the set (`scripts/showcase/data.mjs`, a test fails if stale), update `docs/architecture.md` (the workspace data model), `docs/PROVENANCE.md` and `THIRD_PARTY_NOTICES.md`.

## Tests

Shared: `workspaceIconSchema` cases. Rules: as above. Web: `WorkspaceTile` renders an icon key, falls back for an unknown key and still renders letters and emoji; picker search and selection; the dialogs submit `mi:<key>`. A generated-file test: the module is up to date with the script (the script is deterministic) and every key is unique and matches the regex. Visual: add the new picker to `tests/visual` only if the existing pattern makes it cheap; update baselines with the workflow, never by hand.

## Hot spots and order

Touches `packages/shared`, `firestore.rules`, `tests/rules/**` (hot spots), `pnpm-lock.yaml` and `THIRD_PARTY_NOTICES.md` if a dependency is added, and baselines. Merge after the fonts PR if both touch `THIRD_PARTY_NOTICES.md` (rebase). Security review: this changes a rules path, so the lead reviews the rules diff strictly in-session.
