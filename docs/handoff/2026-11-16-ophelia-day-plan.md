# 2026-11-16 · Ophelia · day plan and what shipped

## What shipped (all merged with rebase, deployed)

- #255 custom label colors with an inline picker (spec `docs/specs/label-custom-colors.md`).
- #259 crisp workspace icons: regular weight, whole-pixel glyph sizes (14/16/24/32/40) from tokens in `theme/icon-picker-tokens.css`. Cause: the tile drew the fill weight at 62% of the tile, giving fractional sizes. Not yet checked in a real browser.
- #258 MCP gap batch 1a: restore, move, reorder groups, like, unlike, find member (25 to 31 tools). Spec `docs/specs/MCP-gap-batch-1.md`.
- #260 sidebar Files tab (SIDEBAR PR 3).
- #257 faster image paste: local preview before upload, parallel uploads, no extra signed-URL lookup. Spec `docs/specs/update-image-paste-speed.md`.
- #262 subitem full page (SUBITEMS PR 3), replacing #261 after review fixes (force-push is blocked, so a new branch).

## Open

- #256 menu-hover flake fix: needs a re-run of its failed `verify` job (an unrelated clock-dependent forms rate-limit test).
- Owner checks (monday Actionable = Yes): icons (3340735612), paste speed, and a decision on `minInstances 1` for the description-image callables.
- #258 minor follow-ups: stale "25 tools" comment in `packages/mcp-core/src/index.d.mts`; `positionBetween` throws a raw error when two siblings share a position; restoring a parent also restores a subitem trashed separately earlier.
- #260 nits: a test for a viewer who wrote the post, and a heading level in `ItemFilesTab`.

## Gotchas

- Six parallel agents pushed the load above 70; suites timed out and the agents could not prove their fixes. Keep to two or three test-heavy agents at once.
- The agents stalled twice (600 s with no progress) while running long silent commands; resume them with a short instruction.
- The visual job tolerates 0.2% pixel difference, so it can pass while tile rendering changed. Take screenshots for visual fixes.
- Every PR this session had a real review finding except #258, #259 and #260; #257 and #261 needed fixes.
