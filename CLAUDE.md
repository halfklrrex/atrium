# CLAUDE.md

@AGENTS.md

Everything shared with other agents (project facts, multi-agent workflow, visual identity, engineering rules) is in `AGENTS.md` above. This file adds Claude-only rules.

## Codenames

- **Ophelia:** Claude (Opus 5.5 technical lead, Sonnet 5.5 coding sub-agents)
- **Ava:** Antigravity (Advanced Agentic Coding pair assistant)

## Model policy (mandatory for the whole project)

| Work type | Model |
|---|---|
| Planning, architecture, data modelling, feature specs, security rules design, code review | **Opus 5.5** (`claude-opus-5-5`) |
| All coding: source, tests, configs, migrations, styling, bug fixes | **Sonnet 5.5** (`claude-sonnet-5-5`), effort **medium** |

- The main session runs on Opus 5.5 and owns planning. It writes a spec for each unit of work in `docs/specs/`, then dispatches the implementation to a subagent with `model: "sonnet"` and `effort: "medium"` (owner decision, 2026-10-26; older specs still say "high effort").
- Opus doesn't write production code directly (this saves usage). Even small code fixes found in review go back to a Sonnet subagent. Opus may edit docs, specs and the monday boards directly.
- After a Sonnet subagent finishes, Opus reviews the diff against the spec, runs the checks and the visual QA, and then opens or merges the PR.
- **Worktrees:** give each Sonnet coding task its own worktree and branch (`claude/<task>`), with its own `ATRIUM_PORT_OFFSET` in `.env.local`. That way two Claude subagents, or Claude and Antigravity, never share a working directory or emulator ports.

## Claude-only tools and access

- **monday boards:** the monday MCP connector. Keep Status, Agent, Branch and Spec / PR current.
- **Reference capture:** Claude in Chrome can take **read-only** screenshots and DOM measurements of the owner's monday account (owner approved on 2026-10-23). Don't change anything in that account.
- **Google Cloud:** `gcloud` and `firebase` CLIs are signed in on this machine. IAM, OAuth client and other security settings are for the owner to change. Give them exact steps.
