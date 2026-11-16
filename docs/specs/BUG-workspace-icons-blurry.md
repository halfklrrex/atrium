# BUG: workspace icons look blurry and not like the picked icons

Owner report 2026-11-11 (monday item 3340735612).

## Cause

- `WorkspaceTile` always drew the Phosphor **fill** weight, while the owner picked icons from the **regular** (outline) weight in the picker, so the tile looked like a different icon.
- The glyph was `62%` of the tile. Tile sizes 20, 24, 40, 56 and 72 px gave 12.4, 14.88, 24.8, 34.72 and 44.64 px glyphs. Phosphor is drawn on a 256 grid with a 16-unit stroke, so strokes are only on whole pixels at multiples of 16 px; fractional sizes and centring offsets anti-aliased every edge, and fill cut-outs smeared at 12 to 15 px.

## Fix

- Tiles and the picker grid (also the selected cell) render the **regular** weight. The generator emits regular paths only, in the single eager `icons.generated.ts`; the fill weight and the lazy `icons-regular.generated.ts` are gone.
- The glyph size is an integer per tile size (`--atrium-tile-glyph-xs/sm/md/lg/xl` = 14/16/24/32/40 px in `theme/icon-picker-tokens.css`). Tile size minus glyph size is even in every case (6, 8, 16, 24, 32), so the glyph lands on the pixel grid.
- The `mi:` legacy mapping and the letter fallback are unchanged.

## Acceptance

- A workspace icon in the sidebar, workspace switcher, Home and the Add workspace dialog looks like the regular icon shown in the picker, with sharp strokes at 1x and 2x.
- `pnpm icons:generate --check`, lint, typecheck, tests and build pass; no fill paths in the bundle.
