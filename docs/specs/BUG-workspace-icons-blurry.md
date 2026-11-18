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

## Follow-up (2026-11-18): the owner wants the filled weight back

The regular weight fixed the blur and the picked-vs-shown mismatch, but the owner prefers the **filled** Phosphor icons (owner request, 2026-11-18). The blur was caused by fractional glyph sizes, not by the fill weight, so the fix stays: integer glyph sizes per tile size.

- Tiles **and** the picker grid (cells and the selected cell) render the **fill** weight, so what is picked is what is shown. The generator emits fill paths only into the single eager `icons.generated.ts`; no regular paths in the bundle.
- Keep the integer per-size glyph tokens (tile minus glyph stays even so the glyph lands on whole pixels). Fill shapes have no strokes, but small cut-outs still smear at fractional sizes: check the xs (20 px tile) and sm (24 px tile) sizes at 1x and 2x in a real screenshot and move to a larger integer glyph (16 px on xs) if the cut-outs look soft.
- Stored keys (`ph:<name>`) don't change; the `mi:` mapping and the letter fallback are unchanged. Existing workspaces and folders keep their icons.
- Checked 2026-11-18 with a throwaway Playwright render at device scale factors 1 and 2: at 14 px on the 20 px (xs) tile the cut-outs (users-three, tooth, rocket) were soft and filled in; at 16 px they were crisp. The xs glyph token is now **16 px** (tile minus glyph = 4, even). sm stays 16 px on the 24 px tile (8, even); 18 px was no crisper.
