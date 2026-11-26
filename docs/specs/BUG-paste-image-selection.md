# BUG: a finished image upload is selected, so typing replaces it

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 (medium effort) · Roadmap: "Pasted image gets selected after upload, so typing replaces it" · Branch `claude/paste-image-selection`

## Problem

The owner pastes a screenshot into an update while writing a comment. A dimmed placeholder with a progress bar appears and the upload finishes. At that moment the finished image is selected, so the next keystroke replaces the image with the typed text.

## Cause (checked at `origin/main`)

`uploadDescriptionImage` in `apps/web/src/components/item-view/description-image-upload.ts` swaps the `imageUpload` placeholder for the `image` node with `editor.chain().insertContentAt({ from, to }, imageNode).run()`. TipTap's `insertContentAt` moves the selection onto the inserted content by default (`updateSelection: true`), which makes the image a node selection. The same code serves the update composer, replies, item descriptions and docs, so all of them have the bug.

The placeholder insert has a related problem: `editor.chain().focus()` pulls focus back to the editor even if the user clicked elsewhere meanwhile (e.g. into another field).

## Fix

1. In the swap on finalize, pass `{ updateSelection: false }` to `insertContentAt` so the selection and caret stay where the user left them. ProseMirror maps the selection through the replacement, so a caret after the placeholder stays after the image.
2. On the failure path (placeholder removed), the same option, so deleting it doesn't move the caret either.
3. On the placeholder insert, keep `.focus()` only when the editor already has focus (`editor.isFocused`); do not steal focus.
4. Keep everything else: previews, progress, parallel uploads, order, the seeded local URL.

## Out of scope

Uploading pasted images as file attachments. Updates can't hold files: `storage.rules` denies clients and there is no upload callable for updates. Images stay inline.

## Tests (Vitest, `apps/web`)

Extend the existing upload tests (`ComposerImages.test.tsx`, `DescriptionEditor.pass2.test.tsx` or a new `description-image-upload.test.ts`):

- paste an image, type "abc" after the placeholder appears, resolve the upload; the doc ends with the image node **and** the text "abc" (before this fix the text replaced the image);
- after finalize the selection is a text selection, not a node selection;
- an upload that fails removes the placeholder and leaves the caret where it was;
- two images pasted together still finish in picked order;
- a placeholder insert does not call `focus()` when the editor is not focused.

No visual change, so no baseline update.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. American English in everything.
