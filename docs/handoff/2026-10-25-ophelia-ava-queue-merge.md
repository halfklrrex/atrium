# 2026-10-25 · Ophelia · Ava's PR queue merged

## Done

- I reviewed and merged all of Ava's open PRs:
  - #23 (timeline, week, hour and world clock columns)
  - #22 (formula)
  - #24 (time tracking)
  - #10 (filters, sort and group-by)
  - #11 (sync and presence)
  - #41 (P2 cell UIs)
  - #34 (server column actions)
  - #35 (file uploads with signed URLs)
- For #22, #24 and #35, a Sonnet subagent merged `origin/main` into the `ag/*` branch (a merge, not a rebase or force-push), and CI passed before each merge.
- New Roadmap status **Pending dependencies** (#42, in `AGENTS.md`).
- The owner granted the signed-URL IAM: `serviceAccountTokenCreator` on the compute SA itself, and `storage.objectAdmin` on the bucket only. `DEPLOY.md` is updated to match.

## Follow-ups (not blocking, logged on the PRs)

- **#10:** `userLookup` is never passed, so group titles and the Person filter show "Board member". There are no visual QA screenshots.
- **#11:** presence `expiresAt` comes from the client clock (±2 min tolerance).
- **#41:** vote writes the whole `votersIds` array, so votes can be lost in a race; use `arrayUnion`/`arrayRemove`. The new types aren't in the showcase seed, and there are no screenshots.
- **#34 / #35:** the server role checks read `workspace.roles[uid]`, while the rules check `memberIds`. The P4 member-removal callable must update both atomically.
- **Security, in flight:** `files` wasn't `serverManaged`, so a forged cell `storagePath` could get a signed URL for another board's object. The fix is on `claude/files-server-managed`.

## Gotchas

- Agent worktrees under `.claude/worktrees/` can exceed Windows' path limit on removal. Use `cmd /c rmdir /s /q "\\?\<path>"`, then `git worktree prune`.
