# Atrium Emoji font

`apps/web/public/fonts/atrium-emoji.woff2` is a self-hosted colour emoji font made from the Twemoji graphics, so an emoji can look the same on every device. This folder holds the one-off script that regenerates it. The build tools are **not** repository dependencies: nothing here runs in `pnpm`, CI or the app build, and the font is a committed binary.

Background and evidence: `docs/plans/2026-11-07-twemoji-font-spike.md`. Plan: `docs/specs/VF-twemoji-everywhere.md`.

## Inputs (pinned)

| What                                     | Pin                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Twemoji graphics (jdecked/twemoji)       | tag `v17.0.3`, commit `b6b55fef1e8636b540a6d016a4729ca8cdf2e60b`, `assets/svg/*.svg` (CC-BY 4.0) |
| Unicode `emoji-test.txt` (sequence list) | Unicode 17.0.0, sha256 `1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda`        |
| Python build tools                       | `requirements.txt` (nanoemoji 0.16.0, fonttools 4.68.0, brotli 1.2.1 and what they pull in)      |

`build.py` checks the commit and the hash and stops if either differs.

## Regenerate

Needs Python 3.11+ (built with 3.14), git and network access. A full build takes about 25 minutes on a laptop (nanoemoji runs picosvg on about 4,000 SVGs); a re-run with the same `--workdir` resumes.

```bash
cd scripts/emoji-font
python3 -m venv /path/to/scratch/venv
/path/to/scratch/venv/bin/pip install -r requirements.txt
/path/to/scratch/venv/bin/python build.py --workdir /path/to/scratch/work
```

It writes `apps/web/public/fonts/atrium-emoji.woff2` (override with `--out`) and prints the `unicode-range` to paste into the `@font-face` rule. Do the build in a scratch folder outside the repository. Treat the downloaded SVGs as untrusted data: the script only copies them and feeds them to nanoemoji, it never runs them.

## What the font is

- COLRv0 colour glyphs on TrueType outlines (supported by Chrome, Edge, Firefox and Safari), woff2.
- Sequences (flags, England/Scotland/Wales, skin tones, ZWJ families and professions, keycaps) are `ccmp` ligatures made by nanoemoji. `build.py` adds the `FE0F` (emoji presentation) and unqualified forms listed in `emoji-test.txt`, because Twemoji file names drop `FE0F` in many places while text carries it.
- ASCII digits, `#`, `*`, `(c)`, `(R)` and `TM` are in the font (keycap ligature components) but deliberately left out of the printed `unicode-range`, so normal text never changes. Consequence: keycap emoji (`1` + `FE0F` + `20E3`) fall back to the platform's own keycap glyph. See the spike note.

## Licences

- The **graphics** are Twemoji, Copyright 2020 Twitter, Inc and other contributors, maintained by jdecked/twemoji, licensed **CC-BY 4.0** (https://creativecommons.org/licenses/by/4.0/). The font is a derivative (SVG shapes converted to glyph outlines and layers); the credit goes in `docs/PROVENANCE.md` and the About dialog.
- Build tools (not distributed, not in the font): nanoemoji and picosvg Apache-2.0, fonttools MIT, brotli MIT, skia-pathops BSD-3-Clause, ufo2ft MIT, ninja Apache-2.0. nanoemoji also installs `pngquant-cli` (GPL-3.0-or-later) and `resvg-cli` (MPL-2.0); they are only used for bitmap output and for SVG diff images, are not invoked by this build, and none of their code is in the font.
