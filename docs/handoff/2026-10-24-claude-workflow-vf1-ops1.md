# 2026-10-24 · Claude · multi-agent workflow, VF1, OPS1, deploy-on-merge

## Done

- **VF1 shell polish (PR #1, merged and deployed):**
  - A floating gradient sidebar and a rounded content panel on the `#EDF1FC` surface.
  - A bordered workspace switcher, no sidebar dividers, and active-route highlighting.
  - A monday-style top bar showing the "Atrium workboards" logo.
- **Shell measurements:** re-measured monday's shell from the live DOM. See `docs/reference/monday-ui-reference.md` → "Shell layout, re-measured".
- **Multi-agent workflow:**
  - `AGENTS.md` holds the shared rules. `CLAUDE.md` imports it and adds the Claude-only rules.
  - `docs/WORKFLOW.md` is the guide for the owner. Session notes now go in `docs/handoff/`.
  - The monday Roadmap has new **Agent** and **Branch** columns.
- **OPS1 (PR #2, merged):**
  - `ATRIUM_PORT_OFFSET` gives each working copy its own block of emulator ports.
  - `.github/workflows/deploy.yml` deploys on every merge to `main`, using Workload Identity Federation.
- **Deploy setup:** the owner did the Google Cloud setup, and the first automated deploy succeeded.
- **Folder layout:** `D:\DevProjects\Atrium\atrium-cl` and `atrium-ag`. The `atrium-cl` copy was copied over, because the app holds a lock on the old folder.

## Gotchas

- **pnpm 12 in CI:** pnpm 12 fails installs on unapproved build scripts. `re2`, an optional dependency of firebase-tools, is denied in `pnpm-workspace.yaml`. It only shows up on Node 22 (CI), not on a local Node 24.13.
- **Port offsets:** the original port table collided between offsets 0 and 100, so storage moved to 9198, logging to 4505 and eventarc to 9297. Use offsets that are multiples of 10.
- **Deploy permissions:** `firebase deploy` also needs `roles/iam.serviceAccountUser` on `atrium-board@appspot.gserviceaccount.com`, not only on the compute service account.
- **Copying the repo:** `robocopy /XD lib` also skips `src/lib` folders. They were restored with `git checkout`.
- **Auto-merge:** auto-merge isn't enabled on the repository, so PRs are merged by hand once CI is green.

## Next

- P1b board table in a worktree.
- Tidy the GitHub Actions warnings: move to the Node 24 action versions and pin the runner image.
