# Twemoji colour font spike (VF-E1)

Spec: `docs/specs/VF-twemoji-everywhere.md`. Date: 2026-11-07. Written by a Sonnet 5.5 subagent for Ophelia.

**VERDICT: font OK**

A self-hosted COLRv0 woff2 built from the pinned Twemoji SVGs works in a real Chromium: faces, skin tones, ZWJ families, country flags, England, rainbow flag and newer emoji all render as Twemoji at 14px and 32px, in a table cell, an `<input>` and a `contenteditable`, including while typing. It is 648 KiB, loads only when the page contains an emoji, and the build tools stay out of the repository. Two known gaps and three unchecked platforms are listed below; none of them blocks VF-E2, but the owner's manual check on Mac and iPhone (the spec's manual test) decides whether Safari is fine.

## 1. Font source: option (a) worked

Built from the SVGs with nanoemoji, no fallback to the prebuilt Twemoji Mozilla font needed.

| Input / tool                      | Version                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Twemoji graphics, jdecked/twemoji | tag `v17.0.3`, commit `b6b55fef1e8636b540a6d016a4729ca8cdf2e60b`, 4,009 files in `assets/svg/`           |
| Unicode `emoji-test.txt`          | 17.0.0 (file date 2025-08-04), sha256 `1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda` |
| nanoemoji                         | 0.16.0 (with picosvg 0.23.0, skia-pathops 0.9.2, ufo2ft 3.11.0, ninja 1.13.2)                            |
| fonttools / brotli                | 4.68.0 / 1.2.1                                                                                           |
| Python                            | 3.14.10 (Homebrew, macOS), in a venv outside the repo. All pins: `scripts/emoji-font/requirements.txt`   |

Build: `nanoemoji --color_format glyf_colr_0` over the 4,009 SVGs (renamed to `emoji_u<codepoints>.svg`), then a small fonttools step. About 25 minutes on this laptop, almost all of it picosvg and the reuse analysis; a re-run in the same work folder resumes. It is a documented one-off, not a CI step. Output: 1,825,560 bytes TTF, 1,453 cmap entries, 4,034 sequences.

**Ligatures.** nanoemoji emits every multi-code-point sequence as a `ccmp` ligature (2,582 of them). Checked by reading the GSUB table of the final font: country flag (`1F1EB 1F1F7`), England (`1F3F4` + tags + `E007F`), keycap `1` (`31 20E3`), skin tone (`1F44D 1F3FD`), the family ZWJ sequence (`1F468 200D 1F469 200D 1F467 200D 1F466`) and the rainbow flag are all present.

**One thing nanoemoji does not do, and the script fixes.** Twemoji file names drop `FE0F` in many places (`31-20e3.svg`, `2764.svg`), but real text carries it (`31 FE0F 20E3`, `2764 FE0F`). `scripts/emoji-font/build.py` adds every form listed in `emoji-test.txt` as an extra ligature pointing at the same glyph (1,272 added), plus the unqualified forms. Without this step keycaps and many symbols would not match.

## 2. Rendering test

Test page: `@font-face { font-family: 'Atrium Emoji'; src: url(atrium-emoji.woff2); unicode-range: <emoji ranges>; font-display: swap }` and `font-family: 'Atrium Emoji', Figtree, system-ui, sans-serif` on `body`, served from a local HTTP server. Browser: **Playwright's Chromium 156.0.8078.4 (headless) on macOS**, device scale factor 2. Screenshots (scratch only, not committed): `chromium-full.png`, `chromium-after-typing.png`, `chromium-digits-in-range.png`. I also read the font Chromium actually used per element through the DevTools `CSS.getPlatformFontsForNode`, so "it looks like Twemoji" is backed by "the used font is Atrium Emoji".

What I saw, honestly:

- **Face, thumbs up + skin tone, ZWJ family, FR flag, England flag, rainbow flag, heart with `FE0F`:** each is a single glyph from `Atrium Emoji` and looks like Twemoji (flat yellow face, tan thumb, blue-box family glyph, tricolour, red cross on white). At 14px they are small but clean; at 32px crisp. Same result in a table cell (14px and 32px), in an `<input value>` and in a `contenteditable`, where the emoji sit on the text baseline with matching height.
- **Typing:** typing and pasting (`insertText`) a flag and a ZWJ couple into the contenteditable, and setting new input text, rendered Twemoji immediately.
- **Newer emoji** (melting face, shaking face, leafless tree, phoenix, lime, face with bags under eyes): render as Twemoji 17.
- **Plain text is untouched** (`Hello 123 # * (c) (R) TM`): digits, `#`, `*`, `(c)`, `(R)` and `TM` stay in the text font because they are left out of the `unicode-range`.
- **Keycaps are not Twemoji (gap 1).** `1 FE0F 20E3` and `# FE0F 20E3` fall back to Apple Color Emoji. Cause: Chromium picks the font for the sequence by its first character, and `1`/`#` are outside the `unicode-range` on purpose. I confirmed the reverse in a second run: adding `U+23, U+2A, U+30-39` to the range makes keycaps render as Twemoji, **but then every plain digit and `#`/`*` on the page renders as an empty glyph** (the font's digit glyphs are the zero-width keycap components). So the only safe setting is: keycaps stay native. Making them work would need real digit outlines inside the font, which is not worth it for a rare emoji. Decision for VF-E2: accept native keycaps and say so in the checklist.
- **Text-default symbols turn colourful (gap 2).** `unicode-range` cannot see a following `FE0F`, so the symbols that are text by default but have an emoji form (heart, check mark, play triangle, left-right arrow, and similar) render as Twemoji even without `FE0F` (seen: `U+2764`, `U+2714`, `U+25B6`, `U+2194` in plain text). `(c)`, `(R)` and `TM` are excluded and stay text. If the owner dislikes this, the alternative is to drop that class from the range, which would keep them native even with `FE0F`. Not decided here.
- **Possible side effect of `U+200D` in the range:** a ZWJ in a joining script (Arabic, Indic) could be handed to the emoji font run. Not reproduced, not tested with such text; the audience is unlikely to hit it, but VF-E2 could check one Arabic or Hindi string.

### Not checked (do not assume these work)

- **Safari on macOS:** not checked. I tried to drive Safari from the shell, but it needs an Automation permission prompt that only the owner can accept, so I stopped. COLRv0 support in Safari is documented, but ligature (`ccmp`) handling of flags and ZWJ sequences, and the `contenteditable`/`<input>` paths, are unverified.
- **Safari on iOS (and every iOS browser, which all use WebKit):** not checked.
- **Windows (Chrome, Edge, Firefox):** not checked. Windows is the platform the owner cares about most; DirectWrite should handle COLRv0, but this is untested.
- **Firefox, Android Chrome, Linux:** not checked.
- Only one Chromium version was run, headless. No test of very long documents, many distinct emoji at once, or the real Atrium UI (this PR changes no app code).

## 3. Size and loading

- **woff2: 663,528 bytes (648 KiB)**, committed at `apps/web/public/fonts/atrium-emoji.woff2` (sha256 `d37f464b55ef811790662f229570ea3e8c019124b90db31ab80f9f424c045ab6`). Budget was under 1.5 MB. The TTF is 1.8 MB. woff2 is already compressed (gzip makes it 663,702 bytes, no gain), so hosting adds no further saving.
- **Lazy loading verified:** a page with only plain text (`Hello world 123 # *`) made **0** font requests, the emoji page made **1**. This is `unicode-range` working in Chromium, with `font-display: swap`.
- The `unicode-range` string (149 ranges, 1,696 characters, including `U+FE0F`, `U+200D`, `U+20E3`, regional indicators, skin tones and the tag block `U+E0020-E007F`) is printed by `build.py` for VF-E2 to paste.
- Upside: the font is cached with the app, so it is one 648 KiB fetch for the first emoji and none after.

## 4. Licences

- **Graphics: CC-BY 4.0.** The repository's `LICENSE-GRAPHICS` is the full CC-BY 4.0 text and the Twemoji README (Attribution Requirements) asks for credit. Credit text to use (update the existing `docs/PROVENANCE.md` row in VF-E2: now the whole set, bundled as a font, and modified by conversion, no longer fetched from jsDelivr, no longer "unmodified"): "Emoji graphics are Twemoji, copyright 2020 Twitter, Inc and other contributors, maintained by the jdecked/twemoji project, licensed under CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Converted to a colour font for Atrium." Also mention it in the About dialog.
- **Twemoji code** (MIT) is not used.
- **Build tools** (not repository dependencies, not distributed, no code in the font): nanoemoji and picosvg Apache-2.0, fonttools MIT, brotli MIT, skia-pathops BSD-3-Clause, ufo2ft MIT, ninja Apache-2.0. nanoemoji installs two more tools, `pngquant-cli` (GPL-3.0-or-later) and `resvg-cli` (MPL-2.0); their rules exist in nanoemoji's generated `build.ninja` but were **never executed** in this build (checked in the ninja log), so neither is involved in the output. No `pnpm licenses:notices` run is needed, since no dependency is added.
- The font file name is `Atrium Emoji`, not Twemoji or Twitter, and no Twitter marks are used.

## 5. Recommendations for VF-E2

1. Paste the `unicode-range` printed by `build.py`; keep `U+FE0F`, `U+200D`, `U+20E3`, the regional indicators and the tag block in it.
2. Put `'Atrium Emoji'` first in the stack as in the spec; Chromium inherits it into inputs and contenteditable without extra CSS.
3. Keep `<Emoji>` call sites working during the transition, then remove them as the spec says. Keycaps and the text/colour symbol behaviour above are known, accepted differences.
4. Owner manual test on Mac, iPhone and Windows (spec: Tests section) is the real gate for Safari and Windows. If Safari mishandles ligatures, the fallback in the spec still applies (or limit the font to the cases that work).
5. Reproducibility: the committed woff2 was written by `scripts/emoji-font/build.py` (its font-patching and woff2 step, run on the nanoemoji output of this build; the full script was not re-run end to end because that takes about 25 minutes, so the first-run fetch, pin check and staging steps were exercised separately and the nanoemoji command is the one used above). A second write of the same TTF differs by a few header bytes only (24 bytes, probably the font timestamp) and renders the same. Whoever runs it first should expect to confirm the hash check and the build end to end.
