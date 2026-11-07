# VF Twemoji on every device

Roadmap item: "Twemoji emoji on every device" (VF group). Branch `claude/twemoji-everywhere`. Owner request, 2026-11-07: the Twemoji flag pictures look good on Windows, and the owner would like every emoji, on every device (Windows, Mac, phones), to look like them. Decisions below are the lead's; defaults stand unless the owner changes them.

## Goal

An emoji looks the same in Atrium on every platform: workspace icons, the Country column, rich text, update feeds, the emoji picker, notification text, and **while typing inside the editors**. No third-party CDN request for emoji.

## Today

- `Emoji.tsx` swaps in a Twemoji SVG from jsDelivr, **for flags, on platforms where a canvas check says flags are missing (Windows)**. Detection and URL building: `apps/web/src/lib/flag-emoji.ts`.
- Emoji inside the TipTap editors (`DescriptionEditor`, `UpdateComposer`, `@tiptap/extension-emoji`) and in inputs are native text, so they cannot be swapped by a React component.
- Text uses Vibe's `--font-family` (Figtree, loaded from Google Fonts in `apps/web/index.html`).

## Decision: a self-hosted colour emoji font

1. Ship a woff2 colour font containing the Twemoji glyphs and declare it with `@font-face { font-family: 'Atrium Emoji'; src: url('/fonts/atrium-emoji.woff2') format('woff2'); unicode-range: <emoji ranges>; font-display: swap; }`. The `unicode-range` limits it to emoji code points (including regional indicators, tag characters, variation selector, ZWJ and keycap bases only as part of sequences), so it never changes how text looks.
2. Put `'Atrium Emoji'` **first** in the font stack for the whole app. Vibe sets `--font-family` on its theme root; override it in one place in `apps/web/src/theme/` (a new `emoji-tokens.css`, imported by the theme entry), keeping Vibe's own stack after it. Inputs, textareas and contenteditable inherit it.
3. A font is preferred over `<img>` because it covers every surface at once (including the editors and the picker), needs no per-surface code, and is cached with the app.
4. `Emoji.tsx` and `flag-emoji.ts` are then **removed or reduced to a pass-through** (the `<Emoji>` call sites are `WorkspaceTile`, the item-view `EmojiPicker`/`DescriptionEditor`/`EmojiSuggest`/`emoji-data`, `ComposerToolbar`, `RichText`, `UpdateComposer` and `columns/country.tsx`): delete the Windows detection and the jsDelivr URL. Keep the component as a thin wrapper only if a call site needs it.

## The spike (do this first; it decides the build)

A Sonnet agent answers, with evidence, in `docs/plans/2026-11-07-twemoji-font-spike.md`:

1. **Font source**, in this order of preference: (a) a **COLRv0 font built at build time** from the pinned Twemoji SVGs (jdecked/twemoji `v17.0.3`, graphics CC-BY 4.0) with `nanoemoji` (Apache-2.0) plus `fonttools` (to woff2); (b) the prebuilt **Twemoji Mozilla** COLR font if its licence (graphics CC-BY 4.0, font code Apache-2.0 / MPL) and age are acceptable; (c) neither works, see the fallback. Record the exact versions and commit SHAs. The font file is a committed binary asset, with the generation script in `scripts/` so it can be rebuilt.
2. **Rendering**, checked in real browsers: Chrome (Windows or macOS), Safari macOS, Safari iOS if reachable (otherwise say it was not checked). Cases: a face, a skin-tone modifier, a ZWJ family, a flag (country and England), a keycap, and a multicolour glyph at 14px and 32px inside a cell, an input and a contenteditable. **COLRv0 is supported by Chrome, Edge, Firefox and Safari; if Safari mishandles it, say so.**
3. **Size:** the woff2 byte size. Budget: under 1.5 MB, loaded lazily through `unicode-range` (only fetched when the page contains an emoji) with `font-display: swap`.
4. **Licence:** the CC-BY 4.0 credit stays in `docs/PROVENANCE.md` (update the row: now the whole set, bundled as a font, not fetched). Run `pnpm licenses:notices` only if a dependency is added to the repo (the build tools should not be repository dependencies: a documented one-off script).

The spike ends with a clear verdict: **font OK**, or **use the fallback**.

## Fallback (only if the spike's verdict is "no")

`<img>` Twemoji on every platform, for display surfaces only (the `<Emoji>` call sites above), and native glyphs remain inside the editors and inputs. Self-host the SVGs the app needs instead of jsDelivr only if the size is reasonable; otherwise keep the pinned CDN. Record this in the spike note.

## Work packages

- **VF-E1 spike** (above): docs-only PR with the note and, if the verdict is OK, the generation script and the font.
- **VF-E2 apply:** the `@font-face` and stack override, remove the detection, update tests (`flag-emoji.test.ts`, `Emoji.test.tsx` are deleted or replaced), `docs/architecture.md` section 4 (no external emoji requests any more), `docs/PROVENANCE.md`, visual baselines (workflow), and a check-list section.

## Tests

- A unit test that the stack puts `Atrium Emoji` first and that the `@font-face` points at a file that exists in `apps/web/public/fonts/`.
- A test that no source file imports `jsdelivr` or `twemojiUrl` after the change.
- Visual baselines for a board with emoji in workspace icon, Country cell and an update.
- Manual (owner): the same emoji on Windows, Mac and iPhone, including while typing in the description editor.

## Not in scope

Emoji skin-tone settings, custom emoji, changing the picker's data.
