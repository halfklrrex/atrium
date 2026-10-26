# How Ophelia (Claude) and Ava (Antigravity) work on Atrium together

A plain-language guide for the owner. The rules for the AI agents themselves are in `AGENTS.md`; this page explains what they mean in practice.

## Who's who: Ophelia & Ava

- **Ophelia (Codename: Ophelia):** Claude (Opus 5.5) is the technical lead. She owns architecture, specs, and code reviews, and delegates coding to Sonnet 5.5 subagents.
- **Ava (Codename: Ava):** Antigravity is the pair programming agent working directly with the owner to build features and epics.

## The one-sentence version

Each AI works in **its own copy of the project on its own branch**. Work only joins the real project (`main`) through a **pull request** that has passed every automated check, and only `main` gets deployed to the live site.

## The picture

```
                    GitHub: halfklrrex/atrium
                    ┌─────────────────────────┐
                    │  main  (= the live site) │◄── every merge auto-deploys
                    └────▲──────────────▲──────┘     to atrium-workboards.web.app
             pull request│              │pull request
           (checks must pass)      (checks must pass)
                         │              │
   ┌─────────────────────┴───┐   ┌──────┴──────────────────────┐
   │ Ophelia (Claude's copies)   │   │ Ava (Antigravity's copy) │
   │ D:\DevProjects\Atrium\   │   │ D:\DevProjects\Atrium\      │
   │   atrium-cl  (home)      │   │   atrium-ag                 │
   │                          │   │ branch: ag/<task>           │
   │   + one worktree per     │   │ emulator ports +100         │
   │     task (claude/<task>) │   │                             │
   └──────────────────────────┘   └─────────────────────────────┘
```

## What each piece means

| Piece                        | What it is                                                                             | Why it stops things getting muddled                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Branch**                   | A named line of work, e.g. `claude/p1b-board-table`                                    | Each task's changes stay separate until they're finished and checked.                                    |
| **Separate copy / worktree** | A separate folder on your disk with its own files                                      | The two AIs never edit the same file on disk at the same moment, and never run installs over each other. |
| **Pull request (PR)**        | A request on GitHub to merge a branch into `main`                                      | Every change is reviewable and goes through the automated checks first. You can read any PR on GitHub.   |
| **Automated checks**         | GitHub runs lint, type checks, unit tests, security-rule tests and a build on every PR | Broken work can't reach `main`.                                                                          |
| **Deploy on merge**          | GitHub deploys `main` to Firebase after each merge                                     | The live site always equals `main`. Nobody deploys half-finished work from their own folder.             |
| **Claiming on monday**       | Before starting an item on the Roadmap, the AI sets **Agent** and **Branch** on it     | You can see at a glance who is doing what, and the two AIs never pick the same item.                     |
| **Emulator ports**           | Each copy runs its local test database on different ports                              | Both AIs can test locally at the same time without colliding.                                            |
| **`AGENTS.md`**              | One shared rulebook both AIs read                                                      | Both follow the same architecture, design and testing rules.                                             |
| **`docs/handoff/`**          | Each AI writes its own dated notes file after a session                                | Notes never conflict, and you can read what each one did.                                                |

## What you do day to day

1. **Give each AI a task** from the Roadmap. Good splits are separate features, e.g. "Claude: P1b board table" and "Antigravity: P9 Google Calendar".
2. **Watch the Roadmap**: the Agent, Branch and Status columns show progress.
3. **When a PR is ready**, the AI tells you. You can glance at it on GitHub and merge it, or ask the AI to merge it once the checks are green.
4. The site updates itself a few minutes after the merge.

## What to avoid

- Don't point both AIs at the **same folder**.
- Don't give both AIs the **same Roadmap item**, or two items that change the same screen at the same time.
- A few files are shared hot spots (`firestore.rules`, `packages/shared`, `pnpm-lock.yaml`, `theme/tokens.css`, `firebase.json`). If both AIs need one at once, let one PR merge first; the other then updates its branch from `main`.

## If something does get tangled

Nothing on `main` changes without a PR, so the worst case is a messy branch. That branch can be fixed or simply thrown away without touching the live site. Ask Claude to "sort out branch X" and it will rebase or rebuild it.
