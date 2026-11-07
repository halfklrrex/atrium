#!/usr/bin/env python3
"""Build the Atrium Emoji colour font (COLRv0 woff2) from the pinned Twemoji SVGs.

A documented one-off script, NOT part of `pnpm` or CI. The build tools are not
repository dependencies. See README.md in this folder.

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python build.py --workdir /path/to/scratch

Steps: fetch the pinned Twemoji tag, stage the SVGs under nanoemoji's file-name
convention, run nanoemoji (glyf + COLRv0, sequences as `ccmp` ligatures), add the
FE0F variants of every sequence, write woff2 and print the `unicode-range`.

Twemoji graphics: Copyright 2020 Twitter, Inc and other contributors, licensed
CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/), via jdecked/twemoji.
"""

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

TWEMOJI_REPO = "https://github.com/jdecked/twemoji"
TWEMOJI_TAG = "v17.0.3"
TWEMOJI_SHA = "b6b55fef1e8636b540a6d016a4729ca8cdf2e60b"

EMOJI_TEST_URL = "https://unicode.org/Public/17.0.0/emoji/emoji-test.txt"
EMOJI_TEST_SHA256 = "1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda"

FE0F = 0xFE0F
# Code points that stay in the font (ligature components need them) but are kept
# OUT of the unicode-range, so ordinary text never changes: ASCII digits, # and *
# (keycap bases), (c), (R) and TM.
TEXT_CODEPOINTS = {0x23, 0x2A, *range(0x30, 0x3A), 0xA9, 0xAE, 0x2122}


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, **kw)


def fetch_twemoji(work: Path) -> Path:
    dest = work / "twemoji"
    if not dest.exists():
        run(["git", "clone", "--quiet", "--depth", "1", "--branch", TWEMOJI_TAG, TWEMOJI_REPO, str(dest)])
    sha = subprocess.run(
        ["git", "-C", str(dest), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
    ).stdout.strip()
    if sha != TWEMOJI_SHA:
        sys.exit(f"Twemoji {TWEMOJI_TAG} is {sha}, expected {TWEMOJI_SHA}")
    return dest / "assets" / "svg"


def fetch_emoji_test(work: Path) -> Path:
    dest = work / "emoji-test.txt"
    if not dest.exists():
        with urllib.request.urlopen(EMOJI_TEST_URL) as r:
            dest.write_bytes(r.read())
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    if digest != EMOJI_TEST_SHA256:
        sys.exit(f"emoji-test.txt sha256 {digest}, expected {EMOJI_TEST_SHA256}")
    return dest


def stage_svgs(svg_dir: Path, staged: Path) -> list[Path]:
    # Twemoji: 1f1eb-1f1f7.svg  ->  nanoemoji: emoji_u1f1eb_1f1f7.svg
    staged.mkdir(parents=True, exist_ok=True)
    out = []
    for f in sorted(svg_dir.glob("*.svg")):
        target = staged / f"emoji_u{f.stem.replace('-', '_')}.svg"
        if not target.exists():
            shutil.copyfile(f, target)
        out.append(target)
    return out


def build_ttf(staged_files: list[Path], work: Path) -> Path:
    env = dict(os.environ)
    # nanoemoji shells out to `ninja`, which pip installs next to python.
    env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env["PATH"]
    build_dir = work / "build"
    run(
        [
            str(Path(sys.executable).parent / "nanoemoji"),
            "--color_format", "glyf_colr_0",
            "--family", "Atrium Emoji",
            "--output_file", "AtriumEmoji.ttf",
            "--build_dir", str(build_dir),
            "--upem", "2048", "--ascender", "1900", "--descender", "-500", "--width", "2550",
            *map(str, staged_files),
        ],
        env=env,
    )
    return build_dir / "AtriumEmoji.ttf"


def add_fe0f_variants_and_save(ttf: Path, emoji_test: Path, out: Path) -> None:
    from fontTools.ttLib import TTFont
    from fontTools.ttLib.tables import otTables as ot

    f = TTFont(str(ttf))
    cmap = f.getBestCmap()
    rev = {}
    for cp, gn in cmap.items():
        rev.setdefault(gn, cp)

    def strip(seq):
        return tuple(c for c in seq if c != FE0F)

    lookup = f["GSUB"].table.LookupList.Lookup[0]
    assert lookup.LookupType == 4 and len(lookup.SubTable) == 1, "unexpected nanoemoji GSUB layout"
    st = lookup.SubTable[0]

    seqs = {}  # code point sequence -> glyph name
    for first, ligs in st.ligatures.items():
        for lig in ligs:
            comps = (first, *lig.Component)
            seqs[tuple(rev[g] for g in comps)] = lig.LigGlyph
    for cp, gn in cmap.items():
        if cp != FE0F:
            seqs.setdefault((cp,), gn)
    by_stripped = {}
    for s, g in seqs.items():
        by_stripped.setdefault(strip(s), g)

    # Twemoji drops FE0F from many file names (1f1.. keycaps "31-20e3", "2764", ...) but
    # text carries it ("1 FE0F 20E3", "2764 FE0F"). Add every form emoji-test.txt lists.
    added = {}
    for line in emoji_test.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or ";" not in line:
            continue
        cps = tuple(int(x, 16) for x in line.split(";")[0].split())
        if cps in seqs or cps in added:
            continue
        g = by_stripped.get(strip(cps))
        if g:
            added[cps] = g
    print(f"sequences in font: {len(seqs)}; FE0F/unqualified variants added: {len(added)}")

    table = {}
    for s, g in [*seqs.items(), *added.items()]:
        if len(s) >= 2:
            table.setdefault(cmap[s[0]], []).append((tuple(cmap[c] for c in s[1:]), g))
    st.ligatures = {}
    for first, items in table.items():
        items.sort(key=lambda x: -len(x[0]))  # longest match first
        ligs = []
        for comps, g in items:
            lg = ot.Ligature()
            lg.Component = list(comps)
            lg.LigGlyph = g
            ligs.append(lg)
        st.ligatures[first] = ligs

    f.flavor = "woff2"
    out.parent.mkdir(parents=True, exist_ok=True)
    f.save(str(out))
    print(f"wrote {out} ({out.stat().st_size} bytes)")

    # unicode-range: every mapped code point except the text ones and private use
    # (tag characters U+E0020-E007F are kept: England, Scotland and Wales need them).
    cps = sorted(
        c
        for c, g in cmap.items()
        if c > 0x20
        and c not in TEXT_CODEPOINTS
        and g not in (".notdef", "space")
        and not (0xE000 <= c <= 0xF8FF)
    )
    cps = sorted(set(cps) | set(range(0xE0020, 0xE0080)))
    ranges, start = [], cps[0]
    prev = start
    for c in [*cps[1:], None]:
        if c is not None and c == prev + 1:
            prev = c
            continue
        ranges.append(f"U+{start:X}" if start == prev else f"U+{start:X}-{prev:X}")
        if c is not None:
            start = prev = c
    print("\nunicode-range:\n" + ", ".join(ranges))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workdir", required=True, type=Path, help="scratch folder (kept between runs; a full build takes ~25 minutes)")
    ap.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "apps/web/public/fonts/atrium-emoji.woff2",
    )
    args = ap.parse_args()
    work = args.workdir.resolve()
    work.mkdir(parents=True, exist_ok=True)

    svg_dir = fetch_twemoji(work)
    emoji_test = fetch_emoji_test(work)
    staged = stage_svgs(svg_dir, work / "svgin")
    ttf = build_ttf(staged, work)
    add_fe0f_variants_and_save(ttf, emoji_test, args.out)


if __name__ == "__main__":
    main()
