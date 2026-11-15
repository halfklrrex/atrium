# Custom label colors

Owner request (2026-11-15) and design choice: option A, an inline panel.

## Behaviour

- In the label editors (`apps/web/src/columns/LabelEditors.tsx`, Status/Priority and Dropdown) the color palette keeps the recommended swatches, with a color-wheel swatch as the **last** item.
- Clicking the wheel swatch expands an inline panel under the palette (no popup, works on phones): a saturation/brightness square, a hue slider, a hex field (`#RRGGBB`, with or without `#`, 3-digit shorthand accepted, invalid input flagged and not applied) and a live preview swatch, with Cancel and Use. Use applies the color to that label and closes the panel. Escape cancels. Full keyboard operation (arrow keys on the square and slider) and ARIA labels.
- If a label already has a non-palette color, the wheel swatch shows it as selected.
- **Saved colors, per board:** custom colors already used by the board's labels (any column) appear in a "Custom" row before the wheel, deduplicated, so they can be reused. Derive them from the board's column settings; store nothing new.
- No new dependency if avoidable (a small in-house picker is fine; if a library is added, run `pnpm licenses:notices` and say why).
- Contrast: label text on a custom color must stay readable. Reuse the existing label text-color logic; if it only handles palette colors, make it compute black/white by luminance.

## Rules

- Colors are stored as hex (`hexColorSchema`); no schema or rules change expected. Color literals are allowed only where the lint exceptions need them (the picker gradients are the real exception; use a targeted disable with a reason).
- Tokens for everything else; reduced-motion respected.
- Tests: hex parsing/validation, HSV-to-hex conversion, keyboard use, Use/Cancel, custom row dedup, contrast text color.
- Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Branch from `claude/label-reorder` (same file, stacked PR); rebase on `origin/main` once that PR merges.
