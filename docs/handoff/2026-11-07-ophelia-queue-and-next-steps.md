# 2026-11-07 (end of day), Ophelia: the queue and what a new session must know

Read `HANDOFF.md` first, then this. Details of what shipped today are in `2026-11-07-ophelia-pickers-bulk-edit-approval-on.md`.

## State at the end of the day

- Everything merged is deployed. Approval is ON for new sign-ups; the owner tested it with a second Google account and signed it off. The owner's Chrome (Windows) is the one connected to the Claude in Chrome extension and is signed in as the admin account; a second browser (macOS) is also connected, so ask which one to use (`select_browser`).
- One PR may still be open: `claude/bulk-highlight-overlay`. Found live: the bulk column highlight is applied (`data-bulk-outlined`, class `cellBulk`) but invisible on Status and Priority cells, because the colour pill is `position: absolute` and paints over the cell's own outline. The fix draws it as a `::after` overlay. Verify it live (select rows, hover a Status cell in one of them) before telling the owner it works.
- The showcase board's "This week" group showed every Status as "Stuck" at the end of the day. Nobody asked for that; it looks like the owner's bulk edit testing. Re-seed the showcase (`docs/showcase.md`) if the owner wants it restored.

## Owner decisions (2026-11-07)

- Appeals inbox (spec `docs/specs/ADMIN-4-appeals-inbox.md`): sign in to appeal; two-way; feedback in the same Inbox; **the admin is shown as "Site Administrator" with no admin uid or name on anything the sender can read** (this changed the data design: admin messages store `authorUid/Name/PhotoURL = null`, the acting admin and `closedBy` live in the admin-only `inboxAudit`, the `inbox_reply` notification uses a fixed actor name); caps 10 / 30 / 200 accepted; no email.
- The owner's old "Minerva" messenger code is inspiration only (they offered the folder; a research note exists: `docs/plans/2026-11-07-appeals-inbox-research.md`). Nothing from it is copied. Never open `.env` files in that project.
- The PWA questions are unanswered; PWA is on hold.

## The queue, in order (each has a monday Roadmap item)

1. **Appeals inbox PR2 to PR7.** PR2 = shared schemas + rules + indexes + rules tests (hot spots, small, land fast). PR3 = central "approved only" check in `actorFromRequest` (a real gap: pending or blocked accounts can call some callables) + the blocking change (stop disabling the Auth user, revoke tokens) + the AccountGate shell. Ultrareview checkpoints before PR2, PR3 and PR4 merge. Accounts blocked before PR3 stay disabled: list them (read-only) and ask the owner whether to unblock and re-block them.
2. **Logo.** Propose directions as SVG previews (our own art, no monday names or art), owner chooses, Sonnet applies; PWA-1 reuses the icons.
3. **Export and print.** Print styles and a native .xlsx (spec section first), then a batch bar Export button. Convert is a separate later item.
4. **Live QA (Chrome, read-only):** light mode of the Automation center; VF compare item 3333664237; nested layers in builder value editors; P5 items that need a run (the owner runs them or says "go").
5. **PWA and web push** when the owner answers.
6. **Spec-first epics:** Teams and profiles, Email notifications, Docs editor, Map and Files gallery views, P8 API.

## Gotchas learned today

- Owner replies are threaded and invisible in `get_updates` text; read them with GraphQL. The owner and the agents post from the same account.
- monday `create_item` rejected some column values at create time (Dropdown "Area", Status "Not started" and the long text together); create with minimal values then `change_item_column_values`.
- Force-push is blocked. A PR that conflicts after another merge is replaced by a new branch (cherry-pick), and `docs/plans/owner-check-list.md` is the usual conflict: add check sections in a separate docs PR.
- A rebase-merge on GitHub of a branch built on an older `main` works when nothing conflicts (#153 did).
- Docs must be Prettier-formatted (`pnpm exec prettier --write <file>`); an unformatted doc fails lint and blocks the Deploy workflow on `main` (happened with a handoff note).
- Review catches real bugs every time: always run a separate Sonnet reviewer before merging, and read the diff of the fixes.
- Sonnet agents hit a 5-hour usage limit once; resume a stopped agent with SendMessage rather than starting over.
- Chrome checks of UI can pass in jsdom and still fail on screen (the highlight): verify visual features live before declaring them done.
