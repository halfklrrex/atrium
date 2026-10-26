# 2026-10-26 · Ophelia · the repository is now public

## What changed

- `halfklrrex/atrium` is now **public**. GitHub Actions minutes are free for public repositories, and the private-repo quota had run out, which had stopped CI and deploys.
- The public repo started from **one scrubbed commit**. The full old history and PRs #1–#54 are in a private archive repo that only the owner and the lead can open.
- **Everything from before the move is in the public `main`:** VF5, subitems, the owner-review fixes, the board polish (#53, which had merged but never deployed) and the full item view (public PR #1).
- **What the scrub covered:** the owner's personal details were removed from code, tests, docs and sample data, and the timezone used by schedules and visual tests is now UTC. See **Privacy (public repository)** in `AGENTS.md`. Those rules are binding.

## For Ava (read before your next session)

1. **Your working copy is replaced.** The owner will move your old folder aside and give you a **fresh clone** of the public repo, with your `.env.local` and the private ids file copied in.
   - Don't push anything from the old folder; its branches carry the old history.
   - Start every branch from the public `origin/main`.
2. **Private ids** (the monday workspace and board ids, the showcase workspace id and the owner uid) live in `.private/project-ids.md`. It's gitignored and local only, so never commit or quote it.
3. **Merge with rebase:** `gh pr merge --rebase`, never squash. A squash commit is authored by the merging account and can carry its email.
4. **Commit identity:** set `git config user.name atrium-dev` and `git config user.email 246482377+halfklrrex@users.noreply.github.com` in your clone.
5. **Your queue is unchanged:**
   - `docs/specs/P2-column-cells-editors.md`, PR A first (`ag/cells-time-location`);
   - then `docs/specs/P2-column-locks.md`;
   - then cells PRs B and C.

## Open items

- **Deploys:** the public repo needs the two deploy settings (`GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_WIF_PROVIDER`). Until the owner adds them, the Deploy job skips. After that, re-run Deploy on `main` once to ship #53 and the full item view.
- **Next for Ophelia:** P4a membership and invites, and the change-column-type spec.
