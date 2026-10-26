# HANDOFF.md

Running log for whoever (human or Claude session) picks this project up next. Update at the end of every session.

## Standing rule: model policy

- **Opus 5.5** (`claude-opus-5-5`): all planning, architecture, data modelling, specs, and design review.
- **Sonnet 5.5** (`claude-sonnet-5-5`): all coding tasks, dispatched as subagents (`model: "sonnet"`) from an Opus-led session.
- Full details in `CLAUDE.md` → "Model policy".

## Status — 2026-10-23 (session 1, kickoff)

**Done**

- Agreed project goals: personal monday.com-style app, top-tier feature parity where relevant, self-hosted on Firebase, no monetisation.
- Created preliminary `CLAUDE.md` and this file.
- Decided to base the UI on monday.com's open-source **Vibe** design system (`@vibe/core`, MIT) for an authentic look without copying their brand assets.

**Not done yet**

- No code, no git repo, no Firebase project linked.

## Status — 2026-10-23 (session 1, continued)

**Answers received**

- Vibe design system approach approved.
- Users: owner + invited family/friends, Google sign-in, unlimited workspaces each.
- Blaze plan approved; Firebase project will be created once the app name is picked.
- No feature prioritisation: build phase by phase until parity.
- Integrations wanted: Google Calendar, GitHub, Apple Calendar + other Apple apps; Claude connector (MCP) in a later phase.
- monday.com data import after the clone is complete.

**Done**

- monday workspace "Monday Clone" organised:
  - **Roadmap** board (id in `.private/project-ids.md`): 12 phases (P0–P11), 83 epics with priority, area, scope.
  - **Decisions & Questions** board (id in `.private/project-ids.md`): 11 entries (accepted decisions + open questions).
- CLAUDE.md updated with phases and monday board pointers.

**Name chosen: Atrium.** GitHub repo: https://github.com/halfklrrex/atrium (private, empty).

**Local tooling (checked 2026-10-23):** Node 24.13, npm 11.6, Java 21 (emulators OK), firebase-tools 15.34 (logged in), git 2.52, gh 2.101 (logged in as halfklrrex). pnpm not installed yet; enable via `corepack enable pnpm` during scaffold.

**Open questions**

- Logo for Atrium (not designed yet).
- Waiting on user: Firebase project ID, Firestore/Storage region, web app config (see setup checklist given in chat).
- Proposed (awaiting confirmation): React+TS+Vite stack, web.app domain first, Apple integrations approach. See Decisions board.
- Leftover default group "Group Title" on the Roadmap board can be renamed to "Backlog / ideas" or deleted in the monday UI.

## Status — 2026-10-23 (session 1, P0 build)

**Firebase:** project `atrium-board` (Blaze), Firestore `eur3`. Storage not yet initialised by user (target `europe-west1`). Nothing deployed yet.

**P0 scaffold built by Sonnet subagent, reviewed by Opus.** Verified locally: lint ✓, typecheck ✓, unit tests 48/48 ✓, rules tests 38/38 ✓, build ✓. Stack: React 19.3, @vibe/core 4.5, Vite 8, TS 6.0, firebase 13, zod 4, react-router 7, pnpm 12. Real Google popup not yet tested (emulator sign-in only).

**Review decisions (apply in P1 spec):**

- Boards need `accessUids: string[]` (rule-enforced to equal `keys(access)`) so private/shareable boards can be listed; client merges "main boards of workspace" + "boards where accessUids contains me". Today only `main` boards are listable.
- P4: explicit `board.access` currently outranks workspace role, so a user removed from a workspace keeps board access. Membership removal must also strip board `access` (callable), or rules must require workspace membership too.
- Persist theme to `users/{uid}.theme` (currently localStorage only).
- Code-split the web bundle (1.26 MB single chunk).
- Windows: emulator data may not export on forced stop.

## Next steps

1. ✅ Storage initialised; ✅ first deploy done 2026-10-23, live at https://atrium-board.web.app (deploy: `pnpm --filter @atrium/web build` then `firebase deploy --project atrium-board`). Gotchas hit: compute SA needed `roles/cloudbuild.builds.builder`; bootstrapUser had to be deleted + recreated to get its public invoker binding. Artifact cleanup policy set.
2. Live sign-in failed: bootstrapUser got PERMISSION_DENIED from Firestore because the default compute SA (`392437318549-compute@developer.gserviceaccount.com`, which Functions run as) only has `roles/cloudbuild.builds.builder`. New GCP projects don't auto-grant Editor. User to grant `roles/datastore.user`. Later phases will need more roles (Storage, Secret Manager, etc.); consider a dedicated least-privilege functions service account in P4/P9.
   ✅ User confirmed live Google sign-in works.
3. **Canonical address: https://atrium-workboards.web.app** (user decision 2026-10-23). ✅ Added to Auth authorized domains. Pending:
   - ✅ User (2026-10-23): OAuth web client has JS origin `https://atrium-workboards.web.app` + redirect URI `https://atrium-workboards.web.app/__/auth/handler`; Branding app name "Atrium".
   - ✅ Deployed 2026-10-23: hosting targets `app` → atrium-workboards (SPA), `legacy` → atrium-board (301 to canonical, path + query preserved); `authDomain: "atrium-workboards.web.app"`. Deploy with `pnpm --filter @atrium/web build` then `firebase deploy --project atrium-board`.

## Status — 2026-10-23 (session 1, P1a)

P1a (spec `docs/specs/P1a-shell-workspaces-boards.md`) built by Sonnet, reviewed by Opus, deployed. Checks: lint ✓, typecheck ✓, unit 139 ✓, rules 65 ✓, build ✓. Monday visual references captured to `docs/reference/` (screenshots gitignored). Known visual gaps: sidebar gradient, group colour bar on table header (P1b), other users' avatars (P4), dark mode only spot-checked. Next: P1b spec (board table, groups, items, core column editors). Sonnet fix queued: login copy wrongly says "Access is limited to invited people". Microsoft sign-in deferred. Possible extra Hosting site / custom domain later. 3. Deploy credential as GitHub secret → deploy workflow. 4. Opus: P1 spec (`docs/specs/P1-core-boards.md`) incorporating the review decisions above, then Sonnet builds P1.
