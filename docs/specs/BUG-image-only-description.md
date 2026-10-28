# BUG: a description with only an image (no text) is saved as empty

Author: Ophelia (Opus 5.5) · Implementer: Sonnet 5.5 · Roadmap: 🐞 "A description with only an image (no text) is saved as empty" (3313454486) · Branch `claude/fix-image-only-description`

## Cause

`isEmptyDoc()` in `apps/web/src/components/item-view/description.ts` returns `docToText(doc).length === 0`. An image without alt text, a divider (`horizontalRule`) or an empty table contributes no text, so `buildDescription()` returns `null` and the description is cleared on save. The upload and `items.descriptionImages` are fine.

## Fix

1. Rewrite `isEmptyDoc(doc)` to walk the doc instead of measuring text. The doc is **not empty** when any node is:
   - a text node with non-whitespace text;
   - one of these content nodes, whatever their attributes: `image`, `horizontalRule`, `table`, `emoji`.

   Keep them in one named `Set` (for example `CONTENT_NODES`) next to `BLOCKS`, with a one-line comment, so later node types (mentions in pass 3) are added in one place.

2. Empty paragraphs, headings, list items and task items with no text stay **empty**, as today.
3. `buildDescription()` keeps calling `isEmptyDoc()` after `stripTransientNodes()`, so a doc whose only node is an `imageUpload` placeholder is still empty. Don't change that order.
4. `docToText()` doesn't change: search text stays the same.

## Tests (`description.test.ts`)

- Not empty: a doc with only an image (no alt); only a `horizontalRule`; only an empty table; only an emoji node.
- Empty: an empty doc; one empty paragraph; whitespace-only text; only an `imageUpload` placeholder (through `buildDescription`).
- `buildDescription()` on an image-only doc returns `{ ok: true, value: { doc, text: '' } }` with the image node kept.

## Out of scope

No UI, rules or Functions changes. No visual baseline changes are expected.

## Verify

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
