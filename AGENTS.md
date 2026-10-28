# AGENTS.md — shared rules for every AI agent working on Atrium

Both Claude Code (`CLAUDE.md` adds Claude-only rules on top) and Antigravity read this file. Plain-language overview for the owner: `docs/WORKFLOW.md`.

## Project

Atrium: a personal, self-hosted work-management app modelled on monday.com's top-tier feature set and in-app visual style. Hosted on Firebase. Not monetised. Users are the owner plus invited family and friends, all signing in with Google. Any user can create unlimited workspaces.

- **GitHub:** https://github.com/halfklrrex/atrium (**public** since 2026-10-26). `main` is the live site. The history and PRs from before that date are in a private archive repo that only the owner and the lead can open.
- **Firebase project:** `atrium-board` (Blaze plan).
- **Regions:** Firestore `eur3` (permanent), Storage `europe-west1`, Functions `europe-west1`.
- **Firestore database:** the **named** database `atrium-1` (`eur3`, scheduled backups on). The project's `(default)` database (`nam5`) is unused legacy; leave it alone. The id lives in one constant, `FIRESTORE_DATABASE_ID` in `packages/shared/src/firebase-env.ts`: the web app, the functions (admin client **and** every Firestore trigger's `database` option), the scripts and the test seeds import it, and `scripts/database-id.test.mjs` fails on a hard-coded id or a Firestore client or trigger without it. `firebase.json` can't import it, so it lists the same id in the array form of `firestore` (a test keeps the two equal).
- **Canonical URL:** https://atrium-workboards.web.app. `atrium-board.web.app` 301-redirects to it.
- **Web config:** this is public by design. It lives in `apps/web/src/lib/firebase.ts`, with `authDomain` set to `atrium-workboards.web.app`.
- **Architecture:** `docs/architecture.md`. Per-epic specs are in `docs/specs/`.

## Planning lives in monday.com

Workspace "Monday Clone": see `.private/project-ids.md` (gitignored, local only) for the URL and ids.

- **Roadmap** board: groups are phases (P0–P11, plus VF for visual fidelity) and items are epics. Columns: **Actionable**, Status, Priority, Area, Scope, Spec / PR, **Agent**, **Branch**.
- **Actionable** (owner decision, 2026-10-26) shows at a glance whose move it is on an item. It has three values: red **Yes**, purple **Agents** and blue **No**.
  - Set **Yes** whenever you leave the owner something to read or do on an item: a question or comment, a request to check a live feature (every move to In review), a decision, or a step only the owner can run.
  - The owner sets **Agents** after answering or acting on a Yes, so it's back with the agents. Agents pick these up at the start of each session (see below).
  - Set **No** once it's handled: you've acted on the owner's answer, or the owner has signed the item off.
  - When the owner asks a question on an item, reply on it, then set Yes if your reply needs their answer or action, and No if it doesn't.
  - A Yes always comes with an update on the item saying exactly what's needed, so the owner never has to guess.
- **Decisions & Questions** board: the architecture decision log. Accepted decisions are binding.

## Who's who: Ophelia (Claude Opus 5.5) leads, Ava (Antigravity) pairs (owner decision, 2026-10-24)

Two AI agents build Atrium side by side, known by their official project codenames:

- **Codename: Ophelia** — **Claude** (Claude Code; Opus 5.5 plans and reviews, Sonnet 5.5 sub-agents code). **Ophelia is the technical lead**, directly under the owner, who has the final say on everything.
- **Codename: Ava** — **Antigravity** (Advanced Agentic Coding assistant). Implements assigned features and epics in direct pair programming with the owner. Ava is meant to work using subagents so she can tackle multiple problems at once, research dependencies in parallel, and keep her main context clean; she should always work in subagents whenever helpful.
  - **Subagent models** (owner decision, 2026-10-28). Every subagent that writes or edits code, tests, configs, rules or migrations runs on **Gemini 4 Argon**, like Ava herself. Gemini 3.8 Flash is only for read-only work: searching the codebase, reading docs, summarising files. Rework found in review costs more than the stronger model.
  - **Splitting the work:** give each subagent its spec section, the files it may touch and the rules that apply, and never let two subagents edit the same file at once. Ava reviews each subagent's work against the spec and runs the checks before she commits.
- Both agents are referred to as **she/her** (owner preference). Codenames were renamed from Iris/Aisling and then Olivia on 2026-10-24; older notes may still use the old names.

- **Architecture and specs:** Ophelia (Opus) owns the architecture (`docs/architecture.md`), the decisions on the Decisions board, and the standards in this file. If Ava (Antigravity) wants to change any of these, she raises it with the owner first; she doesn't change them unilaterally.
- **Reviews:** every Ava PR is reviewed by Ophelia before it merges. Ophelia can approve it, request changes in PR comments, or decline it.
- **Ophelia may change Ava's work** when she judges that necessary: correctness, security, the architecture or visual fidelity. Ophelia can push fixes to an `ag/*` branch, or fix things on `main` after a merge. She explains what she changed and why in a PR comment.
- **When Ophelia changes an `ag/*` branch,** Ava must pull or rebase that branch before continuing (`git fetch && git rebase origin/<branch>`). She must not overwrite those commits with a force-push.
- **Review comments:** Ava follows Ophelia's review comments on her PRs. If she disagrees, she replies on the PR, and the owner decides.
- **Precedence:** where this file, Ophelia's specs or Ophelia's review comments conflict with Ava's own preferences or defaults, they take precedence. Only the owner's instructions outrank them.

## Start of every session (mandatory, before any new work)

The agents can't message each other. **Pull-request comments are the channel**: reviews, requests and answers all go there. So each session starts by catching up:

1. **Sync:** run `git fetch origin`. Rebase your branches on `origin/main` (or start fresh from it), then **re-read this file**. Rules change.
2. **Check your open PRs:** list them with `gh pr list --repo halfklrrex/atrium --author @me`. For each one, read the review comments and new commits with `gh pr view <n> --repo halfklrrex/atrium --comments`.
   - Commits from the other agent on your branch? Pull them (`git pull --rebase`). Never force-push over them.
3. **Review feedback comes first.** Address every requested change before starting anything new.
4. **Close the loop:** reply on the PR with what you changed ("Fixed in `<sha>`: …"). If you disagree with a request, reply with your reasoning, and the owner decides. Push, make sure CI is green, then set the Roadmap item back to **Pending Merge**.
5. **Check the bug inbox.** On the monday Roadmap, the **🐞 Bugs** group has an item called "🐞 Bug inbox: Master Comment" (item id 3307382004), where the owner posts each bug as an update. For every update without a reply:
   - reply on it to acknowledge it
   - create a bug item in the Bugs group with a clear title, the details and the screenshot reference, and set Agent, Branch and Status
   - link that item in your reply

   Split the bugs sensibly between the agents: take ones in your own area, and leave a note if the other agent owns that code. Bug fixes follow the normal PR flow. Reply on the owner's update when the fix is live. If you can't access monday, ask the owner to paste the new bug-inbox updates for you.

6. **Check Actionable = Agents.** On the Roadmap, find the items whose Actionable is **Agents**: the owner has answered or acted on them. Read the newest updates on each item in your area and act on them: sign the item off, fix what they found, or reply. Then set Actionable to No (handled) or Yes (you need something more from them).
7. **Only then start new work**, within your open-PR limit, after checking what's in flight. Open bugs rank above new features unless the owner says otherwise.

**Ophelia (Claude Opus, as lead):** at the start of each session, she also checks every open PR from either agent for new commits or replies, re-reviews what changed, and merges what's ready.

## Multi-agent workflow (mandatory)

1. **Claim before you start.** On the Roadmap item, set **Agent** (Claude / Ophelia or Antigravity / Ava), **Branch**, and Status = Planning or Building. Never start an item another agent has claimed. Don't take two items that change the same screen at once.
   - **Work-in-progress limit** (owner decision, 2026-10-28). The limit is on open PRs, not on how much you build, because reviews are the bottleneck and parallel PRs on overlapping code create conflicts.
     - **Ophelia:** at most **2 open PRs** at a time.
     - **Ava:** at most **4 open PRs** at a time, and **only one open PR per overlapping area**: PRs that touch the same files or screen open one after another, the next after the previous one merges.
     - **Hot-spot files** (rule 6) still have only one open PR touching them at a time, across both agents.
     - **Branch work has no limit.** Keep building ahead on pushed branches, and open each PR when the rules above allow it.
     - A PR with requested changes still counts until it's fixed and merged, and fixing requested changes comes before opening anything new.
   - **Check what's in flight first.** Before starting, look at the Roadmap's Building and Pending Merge items and the open PRs. If your work would touch the same screen, data layer or hot-spot files as something in flight, pick a different item or wait. When in doubt, ask the owner.
2. **One branch per task, in your own working copy.**
   - Both copies live under the parent folder `D:\DevProjects\Atrium\`.
   - Ophelia (Claude) uses `D:\DevProjects\Atrium\atrium-cl` plus a git worktree per task, with branches `claude/<short-task>`.
   - Ava (Antigravity) uses `D:\DevProjects\Atrium\atrium-ag`, with branches `ag/<short-task>`.
   - Never edit files in another agent's working copy (its folder on disk). Branches on GitHub are different. As lead, Ophelia may push to `ag/*` branches; see "Who's who" above.
3. **Start from fresh `main`.** Run `git fetch && git switch -c <branch> origin/main`. Before opening a PR, rebase on `origin/main` and re-run the checks.
4. **Merge only through pull requests.** CI (lint, typecheck, unit tests, rules tests, build) must be green. Don't push to `main` directly.
   - **PR description:** what changed, which Roadmap item, and the visual QA screenshots for UI work.
   - **When the PR opens:** set Status to **Pending Merge** and put the PR link in Spec / PR.
   - **Close-out:** after the merge, set Status to Done, or to In review if the owner still needs to look at it (any visible UI change).
   - **Status lifecycle:** Not started → Planning → Building → **Pending Merge** (PR open, waiting for CI and review) → In review (merged; waiting for the owner's look) → Done. Use **Pending dependencies** when the next step can't start until other items or PRs land, and name them in Scope ("Waiting on: #34"). Move it back to Building when they merge. Use Blocked with a short note in Scope when stuck for any other reason.
   - **Visual baselines.** The `visual` CI job compares screenshots of the key screens with the committed Linux baselines in `tests/visual/__screenshots__/`. If your UI change makes it fail on purpose, run **Actions → Update visual baselines** on your branch (`gh workflow run update-visual-baselines.yml -f branch=<branch>`, then `gh run watch`), review the image diffs in the PR's Files changed tab, and mention them in the PR description. Never commit `*-win32.png` or `*-darwin.png`, never edit a `*-linux.png` by hand, and on a merge conflict in a PNG rebase and re-run the workflow instead of resolving it. Details: `docs/visual-testing.md`.
5. **Never deploy from a working copy.** GitHub Actions deploys `main` after each merge.
6. **Shared hot-spot files** are `firestore.rules`, `tests/rules/**`, `packages/shared/**`, `pnpm-lock.yaml`, `apps/web/src/theme/tokens.css`, `firebase.json` and `tests/visual/__screenshots__/**`.
   - Keep changes to them minimal and land them in small PRs.
   - If the other agent has an open PR touching the same file, wait for it to merge, then rebase.
7. **Local emulators.** Each working copy uses its own port block, set by `ATRIUM_PORT_OFFSET` in the repo-root `.env.local` (gitignored):
   - Claude's home copy: `0`
   - Claude's worktrees: `10`, `20` and so on
   - Antigravity: `100`
   - Antigravity's worktrees: `110`, `120` and so on
8. **Handoff notes.** At the end of a session, add `docs/handoff/YYYY-MM-DD-<agent>-<task>.md` with what was done, what's next, open questions and gotchas. Don't rewrite the other agent's notes. `HANDOFF.md` is only an index plus standing facts.
9. **Decisions.** Log new architectural decisions on the Decisions board and in the relevant doc. Don't silently change the architecture.
10. **Keep the showcase board current.** When a feature or column type lands that is visible on a board, extend `scripts/showcase/seed-showcase.mjs` (content in `scripts/showcase/data.mjs`) in the same PR, so the owner's showcase board keeps up with progress. A test fails when a column type with a web cell is missing from it. After the merge, Ophelia re-runs it against production. Details: `docs/showcase.md`.

## Licensing

Atrium is licensed **AGPL-3.0-only** (`LICENSE`, `NOTICE`; owner decision, 2026-10-24). The owner allows copying AGPL and GPL code, under these rules (full list: `docs/PROVENANCE.md`):

- **Register every copy.** Copied or adapted third-party code keeps its upstream copyright and licence header and gets a row in `docs/PROVENANCE.md` (upstream, commit SHA, paths, changes, date, agent) in the same PR. Add `// Modified for Atrium (AGPL-3.0-only), <date>` to changed files.
- **Never copy** from commercial or enterprise folders and files (Twenty `@license Enterprise`, Docmost `ee/`, Baserow `premium/` and `enterprise/`, Planka `.pe.`), from licence-incompatible projects (Huly, Planka, NocoDB, n8n, Outline, tldraw), or brand assets.
- **Dependencies:** run `pnpm licenses:notices` whenever you add, remove or upgrade a dependency and commit `THIRD_PARTY_NOTICES.md`. CI (`pnpm licenses:check`) fails when the file is stale or a production dependency has an unknown or AGPL-incompatible licence. Commercial packages need the owner's approval.
- **Source offer (AGPL section 13):** the About dialog and the login page link to the source code. The repository is public, which satisfies the source offer.

## Visual identity (top priority for the owner)

- Build on **Vibe** (`@vibe/core`, MIT), monday's open-source design system. Never use monday's name, logo or marketing art.
- **Match monday's in-app UI precisely.** The measured reference is `docs/reference/monday-ui-reference.md`. Screenshots are in `docs/reference/monday/`, which is gitignored and private, so it exists only in Claude's home copy. Ask Claude for a copy if you need it.
- **Use tokens only.** Every colour, spacing, radius, shadow and font comes from Vibe CSS variables or `apps/web/src/theme/tokens.css`. No hard-coded hex or px in components.
  - **Enforced in CI.** `pnpm lint` runs Stylelint (`pnpm lint:css`, config `stylelint.config.js`) over `apps/web/src/**/*.css` and an ESLint `no-restricted-syntax` rule over TSX `style` props and SVG colour attributes. They ban colour literals (hex, `rgb()`, `hsl()`, named), raw `px`/`rem`/`em` on margin, padding, gap, radius, font-size, line-height, `font`, letter-spacing and shadows, and numeric or named `font-weight`. `theme/*.css` is the only place for literals, so add a named token there when Vibe has none. For a real exception (e.g. a third-party brand colour) use a targeted `stylelint-disable-next-line <rule> -- <reason>` or `eslint-disable-next-line no-restricted-syntax -- <reason>` comment; the reason is mandatory. Use `var(--border-width)` instead of `1px` in a `box-shadow` ring. Details: `docs/handoff/2026-10-24-claude-vf4-design-tokens.md`.
- **Visual QA gate:** a UI epic isn't Done until its screens have been compared side by side with the monday reference in light and dark, and the gaps fixed or logged in the Roadmap's VF group.
- **Motion:** don't animate layout properties (width, height, padding, margin). Use transform or opacity, and respect `prefers-reduced-motion`.

## Engineering rules

- **Stack:** a pnpm monorepo with `apps/web` (Vite + React 19 + TypeScript + `@vibe/core`), `functions` (Cloud Functions 2nd gen, bundled with tsup), `packages/shared` (types, zod schemas, the column registry) and `tests/rules`.
- **Security rules:** every Firestore and Storage path has rules plus emulator tests before the feature ships. Never loosen rules to make something work. Fix the data or the query instead.
- **Storage rules can't read Firestore:** Storage rules' `firestore.get()` / `firestore.exists()` only reach the project's `(default)` database, and Atrium's data is in the named `atrium-1`. Don't write Storage rules that depend on Firestore documents; see `docs/architecture.md` section 2.1.
- **Writes:** cell edits write field paths (`values.<colId>`), never the whole `values` map. Board `columns` and `groups` changes use transactions.
- **Derived columns:** a column type whose value is computed sets `derived: true` and `compute()` and **stores nothing**. Cell writes go through `columnRegistry.validateCell` (schema, then the optional `validateValue(value, settings)`), and clients never write `values.<derivedColumnId>`. `boards.derivedColumnIds` is **server-maintained** by the `onBoardColumnsWritten` Function: never write it from a client (rules refuse it) and create boards with `[]`. Details: `docs/architecture.md` section 6.2.
- **Server-managed columns:** a column type only Cloud Functions write (`time_tracking`, `files`, `button`) sets `serverManaged: true`; `validateCell` refuses client values, the web cell is read-only ("Managed by Atrium"), and `boards.serverManagedColumnIds` is maintained by the same `onBoardColumnsWritten` Function (create boards with `[]`; rules refuse client writes to it and to `values.<id>`). A PR adding such a type sets the flag. `boards/{id}/activity` is Functions-only. Details: section 6.2.
- **Checks:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules` and `pnpm build` must pass before a PR. Run `pnpm test:visual` locally if you like (optional; CI runs it against the Linux baselines).
- **Secrets:** never commit them. Service-account keys and tokens go in GitHub secrets or Secret Manager only.
- **Auth emulator sign-in:** the emulator's Google popup can't return to the app inside embedded preview browsers. Sign in with email and password through the SDK instead.
- **Deploy gotchas:**
  - The Functions runtime service account needs IAM roles granted explicitly (new projects don't get Editor).
  - A first deploy that fails can leave a callable without its public invoker binding. Delete and recreate it to fix that.

## Privacy (public repository)

This repository is public. Rules for every agent and contributor:

- Never put the owner's or any real person's name, email, account URLs or ids, location or machine details in commits, PRs, issues, comments, docs or test data.
- Say "the owner" in prose.
- Use fictional names on `example.com` (for example "Avery Quinn", `avery@example.com`) in tests and sample data.
- Keep private ids (monday workspace and board ids, showcase workspace id, owner uid) in `.private/project-ids.md`. It is gitignored and local only.
- Commits must use a GitHub noreply email (`<id>+<user>@users.noreply.github.com`), and the author date in UTC (`+0000`) where your tools allow it.
- Merge PRs with **rebase** (`gh pr merge --rebase`), not squash: a squash or merge commit is authored by the account that merges and can carry its email.
- Never push a branch that was created before 2026-10-26 (it carries the old private history). Start every branch from the public `origin/main`.
