# 2026-11-17 · Claude (Sonnet subagent) · Docs editor PR 2: the page, sidebar and menu

Branch `claude/docs-2-page`, spec `docs/specs/P7-docs-editor.md` (PR 2 section).

## Done

- `components/rich-doc/RichDocEditor.tsx` is the old `DescriptionEditor` body moved over (a `git mv`), with injected `images` (the item-scoped upload context; absent = images off), `mentions` (a `MentionSource`: a hook that says which access settings and workspace the "@" list reads), `buildValue`, `placeholder`, `onEdit`, `external`, `canExpand`. `DescriptionEditor` is now a thin wrapper. No description test expectation changed.
- `RichDocEditor` also flushes a pending save on `beforeunload` and when the tab is hidden (applies to descriptions too).
- Doc page `/docs/:docId` (`components/docs/DocPage.tsx`, `use-doc-body.ts`, `doc-body.ts`, `DocMenu.tsx`, `doc-actions.ts`), `docPath`/`docParam`, `NewDocDialog` (`dialogs/DocDialogs.tsx`), "+" menu "Doc" after Board, "New doc" in the workspace page menu, sidebar rows (drag and drop, rename, menu), Content tab rows, Trash entries, `theme/docs-tokens.css`.
- Autosave with `baseRev`: the first save writes rev 1, later saves `baseRev + 1`; a save refused with `permission-denied` shows the toast "This doc changed. Reload to see the latest version." and stops autosaving. Another member's newer save replaces the text when there are no unsaved edits.
- Showcase: "Showcase notes" doc (`docs/showcasenotes` plus `content/body`), allow-list, reset, tests, `docs/showcase.md`.
- Visual: screens `doc-page-{theme}`, `new-doc-dialog-{theme}` (seed `addDoc`/`removeDoc`); `add-menu-*` changes on purpose (new "Doc" row).

## Deviations and gotchas

- The image adapter is the existing `{ boardId, itemId }` context, not an `upload`/`url` pair: the image node, the upload pipeline and the URL cache are keyed on it. PR 5 (images in docs) generalizes it.
- Not in this PR (as the spec's PR breakdown says): presence avatars (PR 3), the Share button (PR 4), the conflict banner (PR 3). The save state ("Saving...", "Saved") shows in the toolbar only.
- The editor toolbar's accessible name is still "Description formatting" on the doc page.
- `buildTree` and `computeDrop` gained a `doc` leaf type; folder `boardCount` still counts boards only.
