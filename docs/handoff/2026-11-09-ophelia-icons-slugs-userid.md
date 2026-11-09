# 2026-11-09 · Ophelia · Phosphor icons, readable URLs, user ID in Settings

## What happened

- The owner switched the workspace icon set from Material Symbols (shipped earlier the same day, PR #206, spec `docs/specs/WS-icons-material.md`) to **Phosphor** (regular and fill) and asked for about 200 icons and folder icons. Spec: `docs/specs/ICONS-phosphor-icon-picker.md`.
- **ICONS PR 1 merged (#217):** `ph:<key>` accepted next to the legacy `mi:<key>` in the shared schema and `firestore.rules`; folders accept an optional `icon`. Hyphens are now valid in both prefixes' keys. The showcase seeder creates no workspaces or folders, so no sample icons were added.
- **Specs merged (#216):** `docs/specs/SLUG-readable-urls.md` and `docs/specs/SETTINGS-user-id.md`.
- **All three builds merged:** #219 user ID in Settings > Profile; #220 readable URLs; #221 Phosphor icons (203 icons, regular paths in a lazy chunk, 161 legacy `mi:` keys mapped, folder icons).

## Next

0. Done: reviews, baselines and merges. Left: the Chrome pass on the live site and the monday sign-off.

1. Review each PR against its spec, run the checks, run **Update visual baselines** where UI screenshots changed (icons, Settings Profile), merge with `gh pr merge --rebase`. The icons and slug PRs touch some of the same files (sidebar, Home, dialogs): merge one, rebase the other.
2. Chrome pass on the live site after deploy: rename a board and open the old link; pick a Phosphor icon for a workspace and a folder; an old `mi:` workspace still shows an icon; Settings > Profile user ID and Copy.
3. Set the monday items to In review with Actionable = Yes (items 3340735612, 3342906727, 3342905549).

## Gotchas

- My local `main` was 27 commits stale at the start of the session and I wrongly said the repo had no Material icons. Run `git fetch` and `git pull` before answering questions about the code.
- CI `verify` runs `prettier --check .`: format new docs/specs with `pnpm exec prettier --write` before pushing (the first spec PRs failed lint on this).
- `pnpm lint` fails locally only on the gitignored `.private/` folder when `.private` is copied into a worktree; do not copy it.
- Stored `mi:` icons stay valid forever; PR 2 maps them to Phosphor at render time (no data migration). A later cleanup could rewrite them.
- The owner asked where their user ID lives: the app had no place for it (Firebase console > Authentication > Users). The Settings item adds one; the MCP connector needs it as `ATRIUM_USER_UID`.
- Visual specs: seed ids must not contain `-` (the URL id is the text after the last dash). Never wait for `networkidle` in tests/visual (Firestore keeps connections open); wait for a DOM marker (`data-weights-loaded`).
- A commit pushed by the baseline workflow does not start CI: push an empty commit to the branch.
- Main bundle: 528.09 kB gzip after the icons PR (was 528.55); the regular-weight icon paths are a 36 kB lazy chunk.
