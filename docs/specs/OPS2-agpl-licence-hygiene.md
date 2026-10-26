# OPS2: AGPL-3.0 licence hygiene

Author: Opus 5.5 · Implementer: Sonnet 5.5 (high effort) · Branch: `claude/ops2-licence` · Worktree `ATRIUM_PORT_OFFSET=10`

Decision (owner, 2026-10-24; see the Decisions board): Atrium may copy AGPL and GPL code, and Atrium is licensed **AGPL-3.0-only**. Set the licence up properly **before** any code is copied. Background is in `docs/research/open-source-reuse.md` §4.

## Build

1. **`LICENSE`:** the full, unmodified AGPL-3.0 text from https://www.gnu.org/licenses/agpl-3.0.txt.
   - Add `"license": "AGPL-3.0-only"` to every workspace `package.json`: root, `apps/web`, `functions`, `packages/shared`, `tests/rules` and `tests/visual`.
   - Keep `"private": true`, because we never publish to npm.
2. **`NOTICE`:**
   - The project name and copyright line: `Copyright (C) 2026 The Atrium authors`.
   - A short AGPL notice (the standard "This program is free software…" paragraph).
   - The statement that Atrium is not affiliated with monday.com, and that its UI is built on monday's MIT-licensed Vibe design system.
   - A pointer to `THIRD_PARTY_NOTICES.md` and `docs/PROVENANCE.md`.
3. **`THIRD_PARTY_NOTICES.md`:** generated, not hand-written.
   - A script `pnpm licenses:notices` (`scripts/third-party-notices.mjs`) builds it from `pnpm licenses list --prod --json` for the production dependencies of `apps/web` and `functions`. For each dependency it lists name, version, licence, repository, and the licence text where it's available in `node_modules`.
   - Fail on, and list, any production dependency whose licence is unknown or incompatible with AGPL-3.0: proprietary, SSPL, BSL, Elastic, Commons Clause, "Sustainable Use", Hippocratic, or EPL-2.0 without a secondary licence. Allow MIT, ISC, BSD-*, Apache-2.0, 0BSD, CC0, Unlicense, MPL-2.0, LGPL/GPL/AGPL-3.0-compatible, BlueOak, Python-2.0 and similar permissive licences.
   - **CI:** add a step to the `verify` job that regenerates the file and fails if it differs from the committed one ("run `pnpm licenses:notices`") or if a disallowed licence appears.
4. **`docs/PROVENANCE.md`:** the register of copied or adapted third-party code. It starts with the table header and no rows.
   - Columns: upstream project, repo URL, commit SHA, upstream path(s), licence, our path(s), what we changed, date, agent.
   - Rules at the top:
     - Every copied or adapted file keeps its upstream copyright and licence header, and gets an added line, `// Modified for Atrium (AGPL-3.0-only), <date>`, if changed.
     - Add the file's SPDX identifier if it lacks one.
     - No copying from files marked commercial or enterprise (Twenty `@license Enterprise`, Docmost `ee/`, Baserow `premium/` and `enterprise/`, Planka `.pe.`).
     - No copying from licence-incompatible projects: Huly, Planka, NocoDB, n8n, Outline, tldraw.
     - Teable's brand assets are excluded.
5. **In-app source offer (AGPL §13):**
   - An **"About Atrium"** item in the avatar menu opens a Vibe dialog showing the app name, the version (the git short SHA, injected at build through a Vite `define`, for example `__ATRIUM_VERSION__`), the line "Atrium is free software licensed under the GNU AGPL v3", and links to "Source code" (`https://github.com/halfklrrex/atrium`, opening the tree at that commit), "Licence" and "Third-party notices".
   - Add a small **"Source code"** link in the login page footnote area.
   - Use tokens only, follow VF4's lint rules, and regenerate the visual baselines for screens that change (login, plus the menu if it's covered).
6. **Secrets and privacy audit of the full git history:** report only; don't rewrite history.
   - Run `gitleaks` (`npx gitleaks@latest` or a pinned binary) over the whole history (`gitleaks detect --log-opts="--all"`), and also grep for private keys, `AIza` keys other than the known public Firebase web key, service-account JSON, `ghp_`/`github_pat_`, and passwords.
   - Check that `docs/reference/monday/` (the owner's private screenshots) has **never** been committed: `git log --all -- docs/reference/monday`.
   - List personal data that would become public if the repo were made public: e-mail addresses (in files and in commit metadata, `git log --format='%ae %ce' | sort -u`), names, the monday workspace URL, GCP project numbers. Classify each as **fine to publish**, **owner should decide**, or **must remove** (with a suggested fix: an edit for current files; history rewriting only if it's truly sensitive, and then only as a recommendation).
   - Put the audit in the PR description and in `docs/handoff/2026-10-24-claude-ops2-licence.md`.
7. **`AGENTS.md`:** add a short "Licensing" section: Atrium is AGPL-3.0-only; copying rules and the provenance requirement; run `pnpm licenses:notices` when you change dependencies; and commercial packages need the owner's approval.

## Owner decision (2026-10-24): the repo stays private for now

Atrium is mostly used by the owner. The in-app "Source code" link may point at the private GitHub repo. Add a note to `docs/PROVENANCE.md` and the PR: once AGPL code has been copied **and** other people use the app, either make the repo public, give those users read access, or provide a downloadable source archive. Still do the full history audit, so it's ready whenever the owner decides on visibility.

## Constraints

- Work only in your worktree, on `claude/ops2-licence` created from `origin/main`.
- Don't change repository visibility or any GitHub settings. Making the repo public is the owner's decision after reading your audit.
- No deploys. Don't merge.

## Done

- `pnpm lint`, `typecheck`, `test`, `test:rules`, `build`, and the CI `visual` job pass, plus the new notices check.
- A PR is open to `main`. End commits with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, and end the PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Report:** the PR URL, the audit results (sorted into must remove / owner decides / fine), and any disallowed dependency licences found.
