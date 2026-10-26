# OPS1: Per-copy emulator ports and deploy-on-merge

Author: Opus 5.5 · Implementer: Sonnet 5.5 (high effort) · Roadmap: P0 "CI/CD pipeline" · Branch: `claude/ops1-ports-deploy`

Context: Claude and Antigravity now work in separate working copies (see `AGENTS.md` and `docs/WORKFLOW.md`). Two problems are left:

1. Every copy's emulators use the same fixed ports, so two copies can't run `pnpm dev` or `pnpm test:rules` at the same time.
2. Deploys happen by hand from whichever folder someone is in, which could ship unmerged work.

## 1. `ATRIUM_PORT_OFFSET`

**How the offset is read:**

- It's an integer, defaulting to 0, read from the environment or from a gitignored repo-root `.env.local` (`ATRIUM_PORT_OFFSET=100`).
- Use one tiny shared loader, `scripts/env.mjs`, so every script reads it the same way.

**Base ports, each shifted by the offset:**

| Service         | Base port |
| --------------- | --------- |
| auth            | 9099      |
| firestore       | 8080      |
| functions       | 5001      |
| storage         | 9199      |
| hosting         | 5000      |
| ui              | 4000      |
| hub             | 4400      |
| logging         | 4500      |
| eventarc        | 9299      |
| Vite dev server | 5173      |

Also set the Firestore websocket port explicitly (base 9150) so it can't collide.

**What has to change:**

- **`scripts/emulators.mjs`:**
  - Generate a gitignored `.firebase.emulators.json`: a copy of `firebase.json` with the shifted emulator ports.
  - Run `firebase emulators:start --config .firebase.emulators.json`, keeping today's import and export flags and the no-shell spawn.
  - Use the hosting `app` target only, if the CLI needs that.
- **`pnpm test:rules`:** goes through the same generator and uses `emulators:exec --config ...`. The rules tests must read the Firestore host and port from the env that `emulators:exec` sets (`FIRESTORE_EMULATOR_HOST`) rather than a hard-coded 8080.
- **Web app:**
  - `pnpm dev` passes the shifted ports to Vite as `VITE_EMULATOR_AUTH_PORT`, `VITE_EMULATOR_FIRESTORE_PORT`, `VITE_EMULATOR_FUNCTIONS_PORT` and `VITE_EMULATOR_STORAGE_PORT`, plus the Vite server port.
  - `apps/web/src/lib/firebase.ts` uses them, falling back to the base ports.
- **Gitignore:** `.env.local` and `.firebase.emulators.json` (check they're already ignored).
- **Proof:** start two copies at once with offsets 0 and 100. Use a second temporary clone, or run the scripts twice with different env values. Both must come up without port errors, and both `pnpm test:rules` runs must pass concurrently. Stop everything afterwards.

## 2. Deploy on merge to `main`

**Workflow:** `.github/workflows/deploy.yml` runs `on: push: branches: [main]` and on `workflow_dispatch`. Use `concurrency: deploy-production` with `cancel-in-progress: false`.

**Steps:**

1. Checkout; pnpm (same setup as `ci.yml`); Node 22; Java 21 isn't needed.
2. `pnpm install --frozen-lockfile`
3. Run the same checks as CI (lint, typecheck, test, build) so a broken `main` never deploys. The rules tests are optional here because CI already ran them on the PR.
4. Authenticate to Google Cloud with **Workload Identity Federation**, using `google-github-actions/auth` pinned to a full release tag. No JSON keys. Inputs come from repo **variables**, not secrets, because these values aren't secret: `GCP_WIF_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT`. It needs `permissions: id-token: write, contents: read`.
5. `pnpm exec firebase deploy --project atrium-board --non-interactive --force`. This uses the repo's pinned firebase-tools. `--force` keeps the artifact cleanup policy step from prompting.

**Guard:** if `vars.GCP_WIF_PROVIDER` is empty, the job prints a clear notice and exits successfully, skipping the deploy. That way the workflow is harmless until the owner finishes the Google Cloud setup.

**`docs/DEPLOY.md`:** write it for the owner, step by step, with the exact `gcloud` commands to:

- create the deployer service account `github-deployer@atrium-board.iam.gserviceaccount.com`
- grant it the minimal roles a full `firebase deploy` needs:
  - `roles/firebasehosting.admin`
  - `roles/firebaserules.admin`
  - `roles/datastore.indexAdmin`
  - `roles/cloudfunctions.admin`
  - `roles/run.admin`
  - `roles/artifactregistry.admin`
  - `roles/iam.serviceAccountUser` on the compute default SA `392437318549-compute@developer.gserviceaccount.com`
  - `roles/serviceusage.serviceUsageConsumer`
  - `roles/cloudbuild.builds.editor`
  - and any others firebase-tools needs; verify against the firebase-tools docs and note your sources
- create a WIF pool `github` and an OIDC provider `github-actions` restricted with `attribute.repository == "halfklrrex/atrium"`
- allow that repo's principal set to impersonate the SA (`roles/iam.workloadIdentityUser`)
- set the two repo variables (`gh variable set ...`)

The commands must be copy-pasteable on Windows PowerShell **and** bash. If one form can't work in both, give both variants.

**README:** update the deploy section to say: merges to `main` deploy automatically; a manual `firebase deploy` is for emergencies only.

## 3. Docs

- `AGENTS.md` already describes `ATRIUM_PORT_OFFSET`. Make sure the implementation matches it: home copy 0, Claude worktrees 10, 20 and so on, Antigravity 100.
- Don't edit `AGENTS.md` or `CLAUDE.md`. If you think they need changes, report them.

## Done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` all pass.
- The concurrent-ports proof is reported.
- Commit on `claude/ops1-ports-deploy`, push, and open a PR to `main` with `gh pr create`. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; end commits with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Don't merge, and don't deploy.
