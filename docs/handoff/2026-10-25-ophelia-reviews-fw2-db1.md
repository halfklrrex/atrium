# 2026-10-25 · Ophelia (Claude) · reviews, FW2, DB1, bug inbox, showcase

## Done (24–25 Oct)

- **Merged:**
  - P1b board table (#16)
  - VF2 visual tests (#7), VF3 empty states (#5), VF4 tokens (#14)
  - the OPS2 AGPL licence setup (#32)
  - the showcase seed (#30, #31)
  - FW1 derived columns (#33) and FW2 server-managed columns (#38)
  - the menu layering bug (#37)
  - DB1, the named database `atrium-1` (#39)
- **Ava merged:** #4, #6, #12, #13, #20, #21, #25, #26, #27 (most of the P2 shared logic, with no table UI yet).
- **monday:**
  - a 🐞 Bugs group with a "Bug inbox" item
  - Agent and Branch columns
  - Pending Merge status
  - the Decisions board updated (named DB, signed-URL files, offline persistence, FW2)
- **Live database:** switched to `atrium-1`. The owner re-signed in, the backfill wasn't needed, and the showcase was re-seeded.

## Gotchas

- **No branch protection.** Always confirm the checks before `gh pr merge`. Commits pushed by the baseline workflow show **no PR checks**; verify the `workflow_dispatch` CI run on the head SHA instead.
- **Worktrees:** only delete a finished agent's worktree whose work is pushed. Bulk-deleting lost OPS2's work once.
- **First deploy of a new Eventarc trigger** can fail on permission propagation. Re-run it with `gh workflow run deploy.yml`.
- **Named database:**
  - Storage rules can't read `atrium-1`, so file access goes through callables and signed URLs.
  - `@firebase/rules-unit-testing` only opens `(default)`; `tests/rules/src/helpers.ts` wraps it.
- **Ports:** avoid offset 30 (port 9180 is often taken).

## Next

- A one-line PR flagging `files` as `serverManaged: true`.
- Re-review Ava's PRs as she pushes: #10, #11, #22, #23, #24, #34, #35. Merge one at a time, on green.
- VF item card, menus and dialogs parity. P2 column cells/editors UI spec. Column locks spec.
