# BUG: deploys hit the Cloud Run CPU quota in europe-west1

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: 🐞 "Deploys hit the Cloud Run CPU quota in europe-west1" (3312197502) · Branch `claude/fix-deploy-cpu-quota`

## Facts (measured 2026-10-28)

- Quota `CpuAllocPerProjectRegion` (run.googleapis.com) for `europe-west1`: **20 vCPU**.
- 24 functions are deployed, every one with **1 vCPU**, `maxInstances` 10, concurrency 80 (256MiB; `purgeTrash` 512MiB).
- `firebase deploy` updates them in parallel and each new revision starts an instance for its health check: about 24 vCPU at once, over the 20 limit. Deploys of PRs #15 and #18 failed this way and passed on a re-run.

## Fix: fractional CPU for every function

1. In `functions/src/lib/global-options.ts`, set `cpu: 0.5` and `concurrency: 1` next to the existing `region` and `maxInstances: 10`. Cloud Run requires concurrency 1 when CPU is below 1. A full deploy then peaks at about 12 vCPU.
   - Put the options in an exported `const` (for example `GLOBAL_OPTIONS`) passed to `setGlobalOptions`, so a test can check it. Keep the file imported first in `index.ts`.
   - Update the comment: why 0.5 vCPU (the regional quota and the parallel deploy), and that concurrency 1 is required below 1 vCPU.
2. Check no function overrides `cpu` or `concurrency` in its own options. `purgeTrash` sets only `memory`, which is fine (0.5 vCPU with 512MiB is allowed).
3. Check with the installed `firebase-functions` types that `cpu: 0.5` with `concurrency: 1` type-checks and is what the docs allow for 2nd gen. If the SDK refuses it, stop and report; don't pick another value.
4. Add a unit test in `functions/` that imports the options and asserts `region: 'europe-west1'`, `cpu: 0.5`, `concurrency: 1` and `maxInstances: 10`, with a comment pointing at this spec. A function needing more CPU later must override it explicitly.

## Out of scope

- No quota increase request (the owner's to make; not needed after this fix).
- No change to `maxInstances`, regions, or the deploy workflow.

## Verify

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- After the merge, Ophelia checks the Deploy job passes in one go and `gcloud run services list` shows CPU 0.5 for every function.
