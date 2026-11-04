# 2026-11-03, Ophelia: autonomous batch

## Done (all merged to main, deployed)

- **Activity web UI (#63):** board Activity log and the item Activity tab, with Person, Column and Date filters.
- **Button actions (#65):** up to 5 ordered steps (`set_value`, `rename_item`, `move_to_group`, `archive_item`), validated and applied as one field-path patch with the `button_clicked` entry in a single transaction. See `docs/architecture.md` section 6.2.
- **Notify action (#72):** `notify` step sends a `button` notification to up to 10 people after the commit. New "Button clicks" preference. A 2-second guard ignores a repeat click on the same button and item.
- **Column settings (#66):** description (tooltip) and default value editor, required hint.
- **Reorder favourites (#68):** drag or Move up/down in the sidebar.
- **Rich-text backend (#69):** `contentDoc` on updates and replies; mentions come from the document. Spec `docs/specs/P1d-update-composer-rich-text.md`.
- **P5 design (#73):** `docs/specs/P5-automations-design.md`, a proposal with six owner questions. No P5 code.
- Roadmap statuses corrected (Chart view, My Work, Activity); Description editor pass 2 signed off.

## Next

- Merge **#74** (rich text in the composer and replies, web). Then add its owner check.
- Fix the flaky world clock tests in `packages/shared` (Roadmap 3328651015).
- P5a waits for the owner's answers.

## Open questions and gotchas

- The Chrome extension was not connected during the batch, so none of the UI was checked on the live site. Everything is on `docs/plans/owner-check-list.md`.
- `move_to_group` keeps the item's position key (the end-of-group key needs `fractional-indexing`, a web-only dependency), so the item can land anywhere in the group.
- Notify needs two accounts to verify.
- Filter the Roadmap by Actionable with the label id (Agents = 4), not the index.
- The `atrium-cl-mcp` worktree folder is locked by a process; delete it by hand later.
