# ICONS: switch the workspace icon set from Material Symbols to Phosphor, add ~200 icons, add folder icons

**Owner decisions (2026-11-09):** use **Phosphor** (regular and fill, each where it fits) instead of Material Symbols; offer a curated set of **about 200 icons** (up from 160); folders get icons too (earlier plan answer 2), with letters and emoji kept as options. Builds on `docs/specs/WS-icons-material.md`, which shipped the Material version on 2026-11-09 (commits 21c5fc6 and f55b319). Roadmap: the "Icon-set build" item (item 3340735612 is the owner's original request).

## What exists today (do not rebuild)

- `apps/web/src/components/workspace-icons/`: `IconPicker.tsx` (Icons / Emoji / Letter), `EmojiTab.tsx`, `grid-keys.ts`, `icons.ts`, `icons.generated.ts` (160 Material icons as SVG path data), tests, CSS module. Tokens in `theme/icon-picker-tokens.css`.
- `scripts/generate-workspace-icons.mjs` (+ test): deterministic generator, `pnpm icons:generate [--check]`, reads `@material-symbols/svg-400` (devDependency, Apache-2.0). Rows are `[key, keywords]` grouped in `GROUPS`.
- `WorkspaceTile` renders `mi:<key>` as an inline `<svg viewBox="0 -960 960 960" fill="currentColor">`, falls back to the first letter of the name for an unknown key.
- Stored value: `workspaces/{id}.icon`, `workspaceIconSchema` (`packages/shared/src/schemas/common.ts`) and `validWorkspaceIcon` in `firestore.rules`: a letter/emoji of 1 to 8 chars, or `mi:<key>` (`^mi:[a-z0-9_]{1,40}$`, max 48 chars in all). Only workspaces; folders and boards have no icon.

## Design

### Source and licence
Phosphor SVGs come from **`@phosphor-icons/core`** (MIT, the raw assets package, not the React one), as a devDependency. The generator reads `assets/regular/<name>.svg` and `assets/fill/<name>-fill.svg` (check the installed layout), extracts the path data (viewBox `0 0 256 256`), and writes the generated module. Nothing from the package ships at runtime except the path strings of the curated icons, so the bundle cost is ~200 x 2 short strings and there is **no** `@phosphor-icons/react` dependency. Register the copy in `docs/PROVENANCE.md`, run `pnpm licenses:notices` and commit `THIRD_PARTY_NOTICES.md`; remove `@material-symbols/svg-400` from devDependencies and from the notices/provenance (update the lockfile).

### Regular and fill
Each generated entry is `{ key, label, keywords, regular, fill }`. Rules for which weight shows where:
- the **tile** (sidebar, switcher, Home, workspace and folder headers) renders **fill** (reads as a solid glyph on the colour);
- the **picker grid** shows **regular**, and the selected cell shows **fill**;
- no other weights; the weight is not stored.

### Stored value
New icons are stored as `ph:<key>`, `<key>` matching `^[a-z0-9-]{1,40}$` (Phosphor names are kebab-case, e.g. `rocket-launch`). The existing `mi:<key>` values stay **valid and readable** forever (owner data may already contain them):
- schema and rules accept `ph:` and `mi:` plus 1 to 8 character letters/emoji (maximum 48 characters in all, unchanged); new writes from the app are always `ph:`;
- `apps/web/src/components/workspace-icons/legacy-material.ts`: a hand-reviewed map from each of the 160 existing `mi:` keys to a Phosphor key (take the key list from the current `icons.generated.ts` **before** deleting it). `findWorkspaceIcon('mi:home')` resolves through the map, so old workspaces show a Phosphor icon with no data migration, and the picker marks the mapped icon as selected. A test fails if a mapped target is missing from the curated set or a legacy key is unmapped;
- an unknown `ph:` or `mi:` key still falls back to the first letter of the name (existing behaviour).

### Curated set (about 200)
Rework `GROUPS` to Phosphor names, 190 to 210 icons, keeping the 13 groups of the Material version where they exist and adding what Phosphor does well. Keep the meanings the owner reviewed in the Material preview (home, family as people-together, never a restroom sign; health as heart/pulse, not a shield-cross; garden, car, school, money, travel, project, book, star, heart, briefcase, rocket, lightbulb, calendar, folder). Seed list (swap freely for names that read better at 16 px; **every key must exist in the installed package**, the generator fails otherwise):

- People and home: house, house-line, house-simple, buildings, bed, couch, bathtub, key, door, users, users-three, user-circle, baby, baby-carriage, cake, balloon, gift, handshake, confetti, dog, cat, paw-print
- Work and money: briefcase, suitcase-simple, storefront, factory, building-office, wallet, credit-card, bank, coins, currency-dollar, piggy-bank, receipt, shopping-cart, shopping-bag, tag, chart-bar, chart-line-up, chart-pie, target, trophy, medal, scales
- Planning: calendar-blank, calendar-check, clock, timer, hourglass, kanban, list-checks, check-circle, note-pencil, notepad, push-pin, bookmark-simple, flag, flag-banner, map-trifold, compass, path
- Communication: chat-circle, chats, envelope-simple, phone, megaphone, bell, at, share-network, link, broadcast, microphone, video-camera
- Health and food: heart, heartbeat, first-aid-kit, pill, stethoscope, barbell, person-simple-run, bicycle, brain, tooth, drop, moon, fork-knife, coffee, pizza, hamburger, carrot, bread, wine, cooking-pot, orange-slice, ice-cream
- Travel and places: airplane-tilt, car, bus, train, boat, rocket-launch, suitcase-rolling, tent, mountains, island, globe-hemisphere-west, map-pin, lighthouse, anchor, gas-pump
- Education: graduation-cap, book-open, books, student, pencil-simple, exam, flask, atom, calculator, translate, lightbulb, puzzle-piece
- Creative: palette, paint-brush, camera, film-slate, music-notes, guitar, headphones, game-controller, pen-nib, scissors, magic-wand, sparkle, star
- Tech: code, terminal-window, bug, database, cloud, cpu, desktop, laptop, device-mobile, wifi-high, robot, lock, shield-check, gear, wrench, hammer, plugs, lightning
- Nature: tree, tree-palm, leaf, plant, flower-lotus, cactus, sun, cloud-sun, snowflake, fire, wind, planet, butterfly, bird, fish, flower
- Shapes: circle, square, triangle, diamond, hexagon, cube, infinity, hash, asterisk, crown, rainbow, smiley, squares-four, folder-simple

Search keeps working on label + keywords.

### Rendering
`WorkspaceTile` renders `<svg viewBox="0 0 256 256" fill="currentColor">` with the **fill** path. Sizes, tokens and the `aria-hidden` behaviour stay as today (no hard-coded px or colours; Stylelint and ESLint enforce this). Rename the component's concept only if cheap: a `FolderTile` can be the same component with the folder colour.

### Folders
Add an optional `icon` to folders (same `workspaceIconSchema`, rename to `iconKeySchema` only if the diff stays small). Folders without `icon` keep today's look (the folder glyph in the sidebar). `FolderDialogs.tsx`: the create and edit dialogs get the same picker (Icons / Emoji / Letter) next to the colour swatches; "no icon" (the default folder glyph) is a visible choice. The sidebar tree shows the chosen icon on the folder's colour in place of the default folder glyph.

### Rules and schema (hot spots)
1. `packages/shared/src/schemas/common.ts`: `ph:` prefix and `WORKSPACE_ICON_KEY_PATTERN` extended (`^[a-z0-9_-]{1,40}$` covers both); `workspaceIconKey()` returns the key for either prefix **and the prefix** (callers need to know whether it is legacy). Tests for `ph:rocket-launch` ok, `ph:Bad`, `ph:` + 41 chars, 49-char string refused, `mi:home` still ok, letter/emoji ok.
2. `folderSchema`: `icon: workspaceIconSchema.optional()`.
3. `firestore.rules`: `validWorkspaceIcon` accepts `^(ph|mi):[a-z0-9_-]{1,40}$`; reuse it for folders (`icon` allowed in the `hasOnly` lists on create and update, validated when present). Never loosen anything else.
4. `tests/rules/src`: workspace icon `ph:` ok / bad shapes refused (as the `mi:` tests); folder create and update with and without `icon`, a non-string or malformed icon refused.
5. Grep `functions/`, `scripts/` (showcase, MCP) and `docs/architecture.md` for the old icon wording; update the data model section. Showcase (`scripts/showcase/data.mjs`): give one workspace and one folder a `ph:` icon.

No production data migration (the legacy map handles `mi:` values at render time). Leave a note in the PR that a later cleanup could rewrite `mi:` to `ph:`.

## Tests

- Generator: `pnpm icons:generate --check` test stays; add: every key exists in the package, keys unique, between 190 and 210 icons, every group non-empty.
- Web: `WorkspaceTile` (ph icon, legacy `mi:home` renders its mapped Phosphor icon, unknown key falls back, letter/emoji unchanged); picker (search, selection stores `ph:<key>`, regular in grid / fill when selected, legacy value shows the mapped icon selected, keyboard grid navigation as before); folder dialogs submit `icon` and "no icon"; sidebar folder shows the icon.
- Shared and rules tests as above. `pnpm lint`, `typecheck`, `test`, `test:rules`, `build`, `licenses:check` green.
- Bundle: report the gzip change of the main chunk in the PR (expected: about neutral or lower, 200 icons x 2 weights replaces 160 x 1).
- Visual: update the existing picker screens (`add-workspace-icons-*`), add the folder dialog with the picker; run the **Update visual baselines** workflow, never commit local PNGs. Visual QA against monday's workspace picker in light and dark; log gaps in the Roadmap VF group.

## Out of scope
Board icons (field stays reserved `null`), replacing Vibe chrome icons, the full Phosphor set, other weights, uploaded icons, rewriting stored `mi:` values.

## Work split (CLAUDE.md model policy)

Two PRs in order, because both touch hot spots:
1. **`claude/icons-schema`** (small): shared schema and rules for `ph:` and folder `icon`, rules and schema tests, showcase fields, architecture wording. No UI change. Merge first.
2. **`claude/icons-phosphor`**: generator switch, curated set, legacy map, tile, picker, folder dialogs and sidebar, notices/provenance/lockfile, tests, baselines.

Each goes to a Sonnet 5.5 subagent (effort medium) in its own worktree with its own `ATRIUM_PORT_OFFSET`. Opus reviews the diff against this spec (the rules diff strictly), runs the checks and the visual QA, and merges with `gh pr merge --rebase`. A separate Sonnet reviewer pass is recommended for PR 2. Roadmap: Planning -> Building -> Pending Merge -> In review, with Actionable = Yes on the move to In review so the owner can check the live picker.
