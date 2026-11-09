# 2026-11-09 · Ophelia · Phosphor icons, readable URLs, user ID in Settings

## What happened

- The owner switched the workspace icon set from Material Symbols (shipped earlier the same day, PR #206, spec `docs/specs/WS-icons-material.md`) to **Phosphor** (regular and fill) and asked for about 200 icons and folder icons. Spec: `docs/specs/ICONS-phosphor-icon-picker.md`.
- **ICONS PR 1 merged (#217):** `ph:<key>` accepted next to the legacy `mi:<key>` in the shared schema and `firestore.rules`; folders accept an optional `icon`. Hyphens are now valid in both prefixes' keys. The showcase seeder creates no workspaces or folders, so no sample icons were added.
- **Specs merged (#216):** `docs/specs/SLUG-readable-urls.md` and `docs/specs/SETTINGS-user-id.md`.
- **Dispatched to Sonnet subagents (worktrees under `Atrium-worktrees/`, port offsets in brackets):** `icons-phosphor` [250], `slug-urls` [240], `settings-user-id` [230]. Each opens its own PR; none is merged yet.

## Next

1. Review each PR against its spec, run the checks, run **Update visual baselines** where UI screenshots changed (icons, Settings Profile), merge with `gh pr merge --rebase`. The icons and slug PRs touch some of the same files (sidebar, Home, dialogs): merge one, rebase the other.
2. Chrome pass on the live site after deploy: rename a board and open the old link; pick a Phosphor icon for a workspace and a folder; an old `mi:` workspace still shows an icon; Settings > Profile user ID and Copy.
3. Set the monday items to In review with Actionable = Yes (items 3340735612, 3342906727, 3342905549).

## Gotchas

- My local `main` was 27 commits stale at the start of the session and I wrongly said the repo had no Material icons. Run `git fetch` and `git pull` before answering questions about the code.
- CI `verify` runs `prettier --check .`: format new docs/specs with `pnpm exec prettier --write` before pushing (the first spec PRs failed lint on this).
- `pnpm lint` fails locally only on the gitignored `.private/` folder when `.private` is copied into a worktree; do not copy it.
- Stored `mi:` icons stay valid forever; PR 2 maps them to Phosphor at render time (no data migration). A later cleanup could rewrite them.
- The owner asked where their user ID lives: the app had no place for it (Firebase console > Authentication > Users). The Settings item adds one; the MCP connector needs it as `ATRIUM_USER_UID`.
