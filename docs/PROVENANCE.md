# Provenance register

Atrium is licensed **AGPL-3.0-only** (`LICENSE`, `NOTICE`). The owner decided on 2026-10-24 that Atrium may copy and adapt AGPL and GPL code. This file is the register of every piece of third-party code that was copied or adapted into the repository. Packages installed through npm are _not_ listed here: they are covered by `THIRD_PARTY_NOTICES.md`.

## Rules

1. **Keep the upstream header.** Every copied or adapted file keeps its upstream copyright and licence header. If the file has no SPDX identifier, add one. If you changed the file, add the line `// Modified for Atrium (AGPL-3.0-only), <date>` (use the comment style of the language).
2. **Register it in the same PR.** Add one row per upstream project and commit to the table below, with the upstream commit SHA, the upstream and our paths, what we changed, the date and the agent.
3. **No commercial or enterprise code.** Never copy from files or folders marked commercial or enterprise:
   - Twenty: files with `@license Enterprise`
   - Docmost: `ee/`
   - Baserow: `premium/` and `enterprise/`
   - Planka: anything with `.pe.` in its name
4. **No licence-incompatible projects.** Never copy from Huly, Planka, NocoDB, n8n, Outline or tldraw. Their licences cannot be combined with AGPL-3.0-only (see `docs/research/open-source-reuse.md` section 4).
5. **No brand assets.** Teable's brand assets (name, logo, artwork) are excluded, even where its code is usable. The same goes for any other project's name, logo and artwork.
6. **Commercial packages need the owner's approval**, whether they are copied or installed.
7. **Check the licence before you copy.** Read the upstream LICENSE file at the commit you copy from, not just the repository badge. Run `pnpm licenses:notices` when you add dependencies.

## Source offer while the repository is private (owner decision, 2026-10-24)

Atrium is mostly used by the owner, and the repository stays private for now. The in-app "Source code" link therefore points at the private GitHub repository. That is fine while nobody else uses the app.

**Once AGPL or GPL code has been copied into Atrium _and_ other people use the app**, AGPL section 13 requires the source to be offered to those users. Pick one of these before that happens:

- make the repository public, or
- give those users read access to the repository, or
- provide a downloadable source archive (for example a link in the About dialog to a tarball of the deployed commit).

Then update the "Source code" links in the app if the location changes.

## Register

| Upstream project     | Repo URL                          | Commit SHA              | Upstream path(s)                          | Licence | Our path(s)                                        | What we changed                                                                         | Date       | Agent                      |
| -------------------- | --------------------------------- | ----------------------- | ----------------------------------------- | ------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- | -------------------------- |
| Vibe (`@vibe/icons`) | https://github.com/mondaycom/vibe | npm `@vibe/icons@4.2.0` | `Favorite` icon (outer star subpath only) | MIT     | `apps/web/src/components/icons/FavoriteFilled.tsx` | Kept the outer star path, dropped the inner cutout and `clip-rule` so it renders filled | 2026-10-25 | Ava (row added by Ophelia) |

## Assets loaded at runtime from a CDN

Not copied into the repository, but shown to users, so they are credited here.

| Upstream project          | Repo URL                           | Version / commit SHA                                   | Used                                                                     | Licence                                                          | Loaded by                                                                                                              | Date       | Agent                     |
| ------------------------- | ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------- |
| Twemoji (maintained fork) | https://github.com/jdecked/twemoji | `v17.0.3` / `b6b55fef1e8636b540a6d016a4729ca8cdf2e60b` | `assets/svg/<codepoints>.svg` for flag emoji only, fetched from jsDelivr | Graphics CC-BY 4.0 (`LICENSE-GRAPHICS`), code MIT (no code used) | `apps/web/src/lib/flag-emoji.ts`, `apps/web/src/components/Emoji.tsx`; only on platforms without flag glyphs (Windows) | 2026-11-05 | Ophelia (Sonnet subagent) |

Attribution (CC-BY 4.0): flag pictures are Twemoji graphics, copyright 2020 Twitter, Inc and other contributors, maintained by the jdecked/twemoji project, licensed under CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/). They are used unmodified.

## Own artwork: the Atrium logo

The Atrium logo (glazed atrium, gable roof of translucent panes, warm floor glow; `apps/web/src/assets/brand/`, `apps/web/public/` icons) is own artwork, owner-approved on 2026-11-07. The concept was first generated with an AI image tool at the owner's request and then traced by hand into vector SVG by Claude. No third-party brand assets or fonts are included. Agent: Ophelia (Sonnet subagent).
