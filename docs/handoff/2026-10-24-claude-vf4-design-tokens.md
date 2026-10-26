# 2026-10-24 · Claude · VF4 design tokens audit and enforcement

## Done

- **Audit.** Every hard-coded colour, spacing, radius, shadow, font and layout literal under `apps/web/src` was found: 36 outside `tokens.css`, tests and `theme/palette.ts`. 21 were replaced with Vibe or `--atrium-*` tokens and 15 are allow-listed (the Google brand button: 11 CSS values and 4 SVG fills). The code base was already mostly token-clean, so the inventory is short. The full table is in the PR description.
- **New tokens** (`tokens.css`): `--atrium-brand-bg` (black override), `--atrium-brand-text`, `--atrium-brand-text-muted`, `--atrium-tagline-font`, `--atrium-tagline-letter-spacing`, `--atrium-font-weight-semibold` (Vibe stops at 500), `--atrium-toolbar-search-width`, `--atrium-help-panel-width`, `--atrium-message-max-width`, `--atrium-login-copy-max-width`, `--atrium-login-card-width`, `--atrium-login-watermark-inset`. Removed the dead `--atrium-topbar-avatar`.
- **`AtriumMark`** now fills its four tiles with `var(--illus-*)` (same hex values as before).
- **Stylelint** (`stylelint.config.js`, `pnpm lint:css`, part of `pnpm lint`): `stylelint-config-standard` plus the token rules. `theme/*.css` is exempt by override. `reportDescriptionlessDisables`, `reportNeedlessDisables` and `reportInvalidScopeDisables` are on, so every disable needs a reason and stale ones fail.
- **ESLint** (`eslint.config.js`): `no-restricted-syntax` flags colour literals (also named colours in colour-like keys) and raw px/rem/em strings in TSX `style` props, and hex or `rgb()` in SVG `fill`, `stroke` and similar attributes. Tests and `palette.ts` are exempt.
- `.claude/worktrees/` is ignored by git, Prettier and ESLint.
- **Proof of no visual change:** all 34 visual screenshots were generated from `origin/main` locally (win32) and then compared against this branch: 34 passed. CI's Linux `visual` job runs with no baseline changes.

## Gotchas

- Adding `stylelint` as a root dev dependency changed `pnpm-lock.yaml` more than a normal add: `@vibe/core` declares `stylelint` as a peer, so pnpm now resolves that peer to the new v17 and drops the old v14 chain.
- Several `stylelint-config-standard` style rules are switched off in the config (class and custom-property patterns, `no-descending-specificity`, colour notation, `media-feature-range-notation` and so on). They are style opinions that would churn working CSS or reorder rules. The rest of standard is on (for example `rule-empty-line-before`, `declaration-property-value-keyword-no-deprecated`); `pnpm exec stylelint --fix "apps/web/src/**/*.css"` fixes the auto-fixable ones.
- Not enforced: `width`, `height`, `min-*`, `max-*`, `top`/`inset` and other layout sizes in px. The spec limits the lint to spacing, radius, type and shadow. The few layout literals that existed were tokenised anyway; consider adding sizing properties later.
- `font-weight` numbers are banned: use `var(--font-weight-normal)` (400), `var(--font-weight-bold)` (500, Vibe's "bold") or `var(--atrium-font-weight-semibold)` (600). For a focus ring in a `box-shadow`, write `0 0 0 var(--border-width) <colour>`.

## Next

- Antigravity's open branches will fail `pnpm lint` after a rebase (details in the PR description). Fix by tokenising, not by disabling.
- Optionally extend the enforced property list to layout sizes.
