# P1d Spec: rich text in the update composer

**Roadmap item:** "Feature: item update composer supports the same rich text and shortcuts as the description (Ctrl+B etc.)" (bug inbox, 2026-11-01, item `3327934712`). **Owner request:** the comment box should have the same text features as the description editor, including keyboard shortcuts such as Ctrl+B.

Two PRs, in this order (the rules must be deployed before the web app writes the new field):

- **PR A `claude/update-rich-backend`**: shared schema, Firestore rules and tests, Functions (mentions from the document), docs. Hot spots (`packages/shared`, `firestore.rules`, `tests/rules`): only one open PR may touch them.
- **PR B `claude/update-rich-web`**: the composer, the renderer, replies. Web only. Started after A is merged and deployed.

## Decisions

1. **Storage follows the description precedent.** An update (and a reply) keeps `content` (a plain-text mirror, so triggers, snippets, activity, the MCP connector and old readers keep working unchanged) and gains an optional `contentDoc`: the ProseMirror JSON document (`{ type: 'doc', content: [...] }`), written by the editor. `content` is always derived from `contentDoc` with `docToText` (`apps/web/src/components/item-view/description.ts`); it must never be empty when `contentDoc` is set.
2. **Old posts stay plain.** No migration: an update without `contentDoc` renders as it does today (`MentionedText`).
3. **No HTML anywhere.** Nothing is stored or rendered as HTML and nothing uses `dangerouslySetInnerHTML`. The read-only renderer (PR B) walks the JSON and renders only known nodes and marks, and links only with `http:`, `https:` or `mailto:` (rel `noopener noreferrer`, `target=_blank`).
4. **Mentions come from the document.** When `contentDoc` is present, the Functions derive the mentioned uids with `mentionedUidsOf(contentDoc)` (`functions/src/lib/notifications.ts`), not from the client-sent `mentions` array, the same way description mentions work. The client still sends `mentions` (derived from the same doc, at most 20, unique) because the rules validate it; the server ignores a disagreeing array.
5. **Features in the composer (v1):** bold, italic, underline, strike, inline code, links, bullet and numbered lists, checklists, text colours and highlights, emoji, @mentions, blockquote, undo/redo, and the keyboard shortcuts that come with them. **Left out:** images and files (they need item-scoped uploads), tables, headings, code blocks, horizontal rules, the slash menu, fonts. Say so in the check list.
6. **Posting:** Ctrl/Cmd+Enter posts (as today); Enter is a new line or list item. The two fake Bold / Italic / Bullets buttons that insert literal markdown are replaced by the real toolbar.

## PR A: backend

### Shared (`packages/shared/src/schemas/update.ts`)

- A constant `UPDATE_CONTENT_DOC_MAX_BYTES = 100_000` (JSON length).
- `contentDoc` on the update and reply schemas and their input schemas: an object with `type: 'doc'` and an optional `content` array (max 500 entries), passthrough for the rest. A `superRefine` rejects a doc whose `JSON.stringify` length exceeds the limit, and a `contentDoc` whose `content` mirror is empty after trimming.
- If `mentionedUidsOf` can move to shared without pulling in Functions-only code, export it from there; otherwise keep it in Functions.
- Tests: valid and invalid docs, the size limit, the mirror required, old plain updates still valid.

### Rules (`firestore.rules`, update and reply `create` and content-edit `update` branches)

- Add `contentDoc` to the `hasOnly` key lists (create, and the content edit allowed to the author or a board manager).
- When present: `contentDoc is map`, `contentDoc.type == 'doc'`, and the existing `content` rules still apply (string, 1 to 50000). Rules cannot bound a map's size; the 1 MiB document limit and the schema check are the guard.
- A content edit that changes `contentDoc` must also change `content` in the same write (both or neither), so the mirror cannot drift: `request.resource.data.diff(resource.data).affectedKeys()` includes both or neither of `content` and `contentDoc`. An edit may remove `contentDoc` while setting plain `content`.
- Rules tests (`tests/rules/src/rules.test.ts`, `helpers.ts`): create with and without `contentDoc`, a non-map or wrong `type` refused, unknown extra keys still refused, edit rules (author, manager, others), both-or-neither on edit, reply parity.

### Functions

- `notifyUpdateMentions` and `notifyReply` (`functions/src/lib/notifications.ts`): when the written doc has `contentDoc`, use `mentionedUidsOf(contentDoc)` (capped at `NOTIFICATION_LIMITS.mentions`) instead of `mentions`; otherwise the array as today. Snippets keep using `content` (the mirror).
- `recordUpdatePosted` (`functions/src/lib/activity.ts`) keeps using `content`; add a test that a doc with `contentDoc` yields the same snippet from the mirror.
- Tests with the fakes: a doc whose array lists a uid that is not in the doc (ignored), and one whose doc has a mention that is not in the array (notified).

### Docs

`docs/architecture.md` (updates section): `contentDoc`, the mirror rule and the mention source. Add a one-line pointer in `P1c-item-card-updates.md`.

## PR B: web (after A is deployed)

- **Composer** (`apps/web/src/components/item-card/UpdatesFeed.tsx` and `UpdateReplies.tsx`): a compact TipTap editor in a new `UpdateComposer` component. Build the extension list as a subset of `createEditorExtensions` (`item-view/editor-extensions.ts`) with a new `createComposerExtensions({ mentionController, emojiController })`; reuse `AtriumMention` and `MentionMenu` (needs `boardId`), the emoji extension and picker, the colour marks and `ColorPopup`. Do not include image nodes or upload handlers, tables, headings, the slash menu or fonts.
- **Toolbar:** a slim `ComposerToolbar` (bold, italic, underline, strike, link, lists, checklist, colour, emoji, @) with tooltips showing the shortcuts; icon-button styles from `UpdatesFeed.module.css`. Do not touch the 720-line `DescriptionToolbar`.
- **Behaviour:** the editor is created lazily (code split like `DescriptionEditor`), and for replies only when the reply box is opened, so a long thread does not create dozens of editors. Ctrl/Cmd+Enter posts and clears with `clearContent()`; an empty doc (`isEmptyDoc`) cannot be posted. Keep the existing disabled, loading and error behaviour. Drafts stay per box.
- **Writes** (`apps/web/src/data/updates.ts`, `createUpdate` and `createReply`): send `contentDoc` (after `stripTransientNodes`), `content = docToText(doc)` (mentions as `@Name`, emoji as `:name:`), and `mentions` from the doc (a client-side walk like `mentionedUidsOf`, max 20).
- **Renderer:** `RichText.tsx`, a pure React walker over the JSON: paragraph, hardBreak, text with marks (bold, italic, underline, strike, code, link, colour and highlight through the same palette tokens the description uses), bullet, ordered and task lists, blockquote, mention (styled like `MentionedText`), emoji. Unknown nodes render their text content only. Used in `UpdatesFeed.tsx` and `UpdateReplies.tsx` when `contentDoc` exists, otherwise `MentionedText`.
- **Edit and other writers:** if an update edit UI exists, it uses the same composer and writes both fields. The MCP connector (`scripts/mcp`) keeps writing plain `content`, which stays valid.
- **Tests:** the composer renders; bold with Ctrl+B and a list from the toolbar produce the right doc; Ctrl+Enter posts `contentDoc`, the mirror and the mentions; an empty doc cannot post; a picked mention lands in `mentions`. `RichText` renders each node and mark, drops `javascript:` links and shows unknown nodes as text. Legacy plain updates still render, and the old markdown-inserting buttons are gone. Visual: the composer open with formatting, and an update showing rich content, in light and dark.

## Out of scope

Images and files in updates, editing history, reactions on rich content, searching update text, an "Edited" label, converting old plain posts, rich text in other text fields.

## Checks

PR A: `pnpm lint`, `typecheck`, `test`, `test:rules`, `build`. PR B: lint, typecheck, test, build, then the baselines workflow. After B merges, the owner tries bold, a list, a mention and a reply.
