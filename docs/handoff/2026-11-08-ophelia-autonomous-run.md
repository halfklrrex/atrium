# 2026-11-08, Ophelia: the autonomous run

The owner was away and asked for long autonomous work (decisions 2026-11-07: security PRs merge after a strict in-session review and the owner runs one batched ultrareview later; visible UI ships after my own visual QA; specs get defaults and are built; showcase re-seeds allowed; nothing else written to production; never touch IAM, secrets or paid providers). The monday "Autonomous run log" item (3339139580) has the per-merge entries.

## Shipped

- Showcase re-seeded. Specs: Twemoji on every device, export slice 2, PWA answers.
- Excel export + Export submenu (#173), Export from the batch bar (#184), print styles and Print (#176; dark theme prints with the light theme swapped in while printing).
- Twemoji font (#174 font and spike note, #179 applied: `theme/emoji-tokens.css`, `Emoji` component removed).
- Appeals and feedback Inbox: #172 rules and schemas, #175 approved-only callables and blocking that no longer disables the Auth user, #178 callables, #180 admin screens, #182 purge, #185 sender screens. Production check before PR3: 2 accounts, both approved, none blocked or disabled (no migration). Both new callables confirmed ACTIVE with a public invoker binding after the PR4 deploy.
- PWA-1 (#183). Live headers for `/sw.js` (no-cache, Service-Worker-Allowed) and `/manifest.webmanifest` (no-cache, application/manifest+json) confirmed with curl after the deploy.
- #181: the run history test no longer fails in the first minutes after midnight.

## Gotchas learned

- A visual-baselines commit pushed by the workflow does not trigger CI: start CI by hand with `gh workflow run ci.yml --ref <branch>` (the PR may show no checks until then).
- The membership dialog test is an occasional flake and the visual job sometimes fails in "Set up Java" or on one slash-menu screenshot: re-run the failed job once before investigating. A second failure is real.
- Agents' reports can overstate: twice a branch was said to be built when it had never been pushed. Check `git log origin/main..origin/<branch>` yourself, and tell agents to push after every step. Agents also cannot see their own layout bugs: the batch bar Export overlapped its neighbours until I looked at the generated screenshot. Always read the baseline images in `tests/visual/__screenshots__/` before merging UI.
- Force-push is blocked: a conflicted PR is replaced by a new branch with cherry-picked commits (done for print and Twemoji).
- A stopped agent can be resumed with SendMessage; a repeating hand-back can be stopped with TaskStop.
- `git branch --merged` cannot see rebase-merged branches; use `gh pr list --state all` before removing worktrees.

## Not done / next

See "Open work" in HANDOFF.md: ultrareview branch, PWA-2 to PWA-4, live QA, and the epics that need a spec (Map and Files gallery views, Teams and profiles, Docs editor, P8 API, Email notifications).
