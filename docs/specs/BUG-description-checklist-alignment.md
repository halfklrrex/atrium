# Bug: description checklist checkboxes misaligned

Roadmap item: "🐞 Description checklist: checkboxes misaligned with their text" (Bugs group). Owner report, 2026-10-26.

## Problem

In the full item view, the description editor's checklist (TipTap `TaskList` / `TaskItem`) doesn't line its checkboxes up with the first line of text. The rule in `apps/web/src/components/item-view/DescriptionEditor.module.css` pads the `<label>` with `var(--space-2)`. But the text line is `--atrium-update-body-font` (15px / 22.5px), and the native checkbox is about 13px with its own browser margins. So the box sits high and to one side, and the misalignment changes with the browser.

## Fix

1. **Centre the box on the first line.**
   - Make the `label` an inline-flex box whose height is the body line height, and centre the checkbox inside it. Add a token if needed, e.g. `--atrium-doc-line-height: 22.5px` in `theme/tokens.css`, and derive the font token from it so the two can't drift.
   - Reset the checkbox's UA margin (`margin: 0`).
   - It must hold for wrapped (multi-line) items, nested task lists (`nested: true`) and a checked item.
2. **Make the checkbox look like monday's.**
   - Size it to 16px with `accent-color: var(--primary-color)`.
   - Checked items get `--secondary-text-color` plus a line-through on the text (`li[data-checked='true'] > div`).
   - Tokens only: Stylelint enforces this.
3. **Spacing.** List items sit `var(--space-4)` apart, and a nested list is indented by one checkbox width plus the gap so its boxes line up under the parent's text.
4. **Read-only view.** The same CSS applies, because it's the same component with `editable: false`. Check it.

## Out of scope

The richer editor (toolbar, slash menu, tables): that's a separate item and spec.

## Tests and QA

- Unit: a test in `ItemView.test.tsx`, or a new `DescriptionEditor.test.tsx`, that renders a doc with a checked and an unchecked task item and asserts that `data-checked` is set. Don't do pixel assertions in jsdom.
- Visual: if the full item view in `tests/visual` shows a description, refresh only that screen's baseline with the workflow's `grep` input. Otherwise add a checklist to the visual seed, if one exists for the item view.
- Manual QA (lead): screenshots in light and dark with single-line, wrapped, nested and checked items; then zoom to check the alignment.
