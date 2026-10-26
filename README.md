# Atrium

Atrium is a personal, self-hosted work-management app in the spirit of monday.com: workspaces, boards, groups, items and typed columns, with realtime sync. It runs entirely on Firebase (Hosting, Auth, Firestore, Cloud Functions, Storage) and uses [Vibe](https://github.com/mondaycom/vibe) (`@vibe/core`) for its UI components. Atrium has its own name and logo and is not affiliated with monday.com.

Status: **P0 - Foundations** (auth, app shell, workspaces, security rules, `bootstrapUser`). See `docs/architecture.md` for the design and `CLAUDE.md` for project rules.

## Layout

```
apps/web/         Vite + React 19 + TypeScript SPA
functions/        Cloud Functions (2nd gen, Node 22, region europe-west1), bundled with tsup
packages/shared/  Types, zod schemas and the column-type registry (@atrium/shared)
tests/rules/      Firestore security rules tests
```

## Prerequisites

- Node.js 22 or newer
- pnpm 12 (`corepack enable pnpm`, or `npm i -g pnpm`)
- Java 21 (the Firestore emulator needs a JVM)
- Firebase CLI is installed locally by `pnpm install` (`firebase-tools`); log in with `pnpm exec firebase login` only if you deploy

## Getting started

```sh
pnpm install
pnpm dev
```

`pnpm dev` builds the functions, then starts the Firebase Emulator Suite (Auth 9099, Firestore 8080, Functions 5001, Storage 9198, Hosting 5000, UI 4000; data persists in `.emulator-data/`), a functions watcher, and the Vite dev server at http://localhost:5173. The web app talks to the emulators because `apps/web/.env.development` sets `VITE_USE_EMULATORS=true`. Sign in with the Auth emulator's fake Google popup.

### Running several working copies at once

The ports above are the defaults for offset 0. Every port is shifted by `ATRIUM_PORT_OFFSET`, an integer read from the environment or from a gitignored `.env.local` at the repo root (`ATRIUM_PORT_OFFSET=100`). Give each working copy its own offset: home copy 0, Claude worktrees 10, 20 and so on, Antigravity 100. With offset 10 the Vite server is on 5183, Firestore on 8090, Auth on 9109, and so on. `pnpm dev`, `pnpm emulators` and `pnpm test:rules` all honour it, so two copies can run them at the same time. They write a gitignored `.firebase.emulators.json` (a copy of `firebase.json` with the shifted ports) and pass it to the Firebase CLI.

## Scripts

| Command           | What it does                                                             |
| ----------------- | ------------------------------------------------------------------------ |
| `pnpm dev`        | Emulators + functions watcher + Vite dev server                          |
| `pnpm emulators`  | Emulator Suite only                                                      |
| `pnpm test`       | Unit tests (Vitest) in all packages                                      |
| `pnpm test:rules` | Starts the Firestore emulator and runs `tests/rules`                     |
| `pnpm typecheck`  | `tsc --noEmit` in all packages                                           |
| `pnpm lint`       | ESLint and Prettier check                                                |
| `pnpm format`     | Prettier write                                                           |
| `pnpm build`      | Builds the web app (`apps/web/dist`) and the functions (`functions/lib`) |

## Deploying

Merges to `main` deploy automatically: `.github/workflows/deploy.yml` re-runs lint, typecheck, unit tests and build, then runs `firebase deploy` against project `atrium-board` using keyless Workload Identity Federation. The owner's one-time Google Cloud setup is in `docs/DEPLOY.md`; until the `GCP_WIF_PROVIDER` repo variable is set, the workflow prints a notice and skips the deploy.

A manual `firebase deploy` is for emergencies only (for example the workflow is broken and a fix must ship now):

```sh
pnpm build
pnpm exec firebase deploy --project atrium-board
```

A deploy publishes the app to Hosting site `atrium-workboards` (https://atrium-workboards.web.app, the canonical address) and a 301 redirect on the legacy site `atrium-board` (https://atrium-board.web.app) that forwards every path to the canonical address, plus Firestore rules and indexes, Storage rules and Functions, all in project `atrium-board`. The Hosting targets `app` and `legacy` are mapped to those sites in `.firebaserc`; the legacy site serves only the redirect and the tiny `hosting/legacy` fallback page. The `functions` predeploy step builds the bundle first.
