# P1: description editor, pass 2 (colours, fonts, emoji, images)

Roadmap item: "Description editor pass 2: colours, fonts, emoji, images" (P1 group). The owner approved it on 2026-10-27; the font set is on the item.

It builds on pass 1 (`docs/specs/P1-description-editor-pass1.md`, PR #16).

## Principles

- **The stored doc holds palette and font _keys_, never raw colours or font stacks.**
  - Marks render as `data-*` attributes plus CSS classes, mapped to tokens, so dark mode and future palette tweaks apply to old content.
  - No hex values or inline `style` attributes in the doc.
  - On paste, foreign inline colours and fonts are dropped (parse rules accept only our keys).
- Everything is keyboard-accessible, with tooltips like pass 1.

## 1. Text colour and highlight

- Use `@tiptap/extension-text-style` (v3 `TextStyle`) plus a small custom extension, e.g. `textColor`. Store `{ color: '<key>' }` on the textStyle mark and render it as `<span data-color="<key>" class="atrium-text-<key>">`. Do the same for highlight with `@tiptap/extension-highlight` (multicolor) and keys in `data-highlight`.
- **Palette:**
  - 10 text colours: grey, red, orange, yellow, green, teal, blue, purple, pink, brown.
  - 10 highlights: the same hues, as light background fills.
  - Define tokens in `apps/web/src/theme/editor-tokens.css`, with light and dark (and black) values from Vibe's colour tokens where possible. Add new named tokens only where Vibe has none.
  - Text colours must keep contrast of at least 4.5:1 on `--primary-background-color` in each theme.
- **Toolbar:**
  - an "A with a coloured underline" button after Strikethrough;
  - it opens a popover with two swatch rows, "Text colour" and "Highlight", each with a "Default" / "None" swatch;
  - swatches have names as tooltips and aria-labels, and the current one is marked.
- Clear formatting (pass 1) also removes colour, highlight and font.

## 2. Font picker

The fonts, by key:

| Key       | Label          | Font              | Notes                                           |
| --------- | -------------- | ----------------- | ----------------------------------------------- |
| `default` | Default        | Inherits the body | No mark; this is the absence of a font mark.    |
| `figtree` | Figtree        | Figtree           | Already loaded.                                 |
| `poppins` | Poppins        | Poppins           | Already loaded at 500/600. Add 400/700, lazily. |
| `lora`    | Lora           | Lora              | Serif.                                          |
| `nunito`  | Nunito         | Nunito            | Rounded.                                        |
| `mono`    | JetBrains Mono | JetBrains Mono    | Monospace.                                      |
| `caveat`  | Caveat         | Caveat            | Handwriting.                                    |

- Add a custom `fontFamily` attribute on the textStyle mark (the same pattern as colour). It renders `data-font="<key>"` and a class that sets `font-family` from tokens (`--atrium-font-<key>`).
- **Lazy loading:** `ensureFontLoaded(key)` injects a single Google Fonts `<link>` per family (weights 400 and 700, with italics where available, `display=swap`), only the first time a key is rendered or chosen.
  - Viewers' editors call it for the keys they find in the doc on load.
  - Families already in `index.html` aren't re-requested.
  - Check that the CSP (if any in `firebase.json` hosting headers) allows `fonts.googleapis.com` and `fonts.gstatic.com`; `index.html` already loads from them.
- **Toolbar:** a "Font" dropdown next to the text-style dropdown. Each option is rendered in its own font, and loading on hover is fine. It shows the current font, or "Default".
- **Licence:** all are OFL. Fonts are loaded from Google, not bundled, so no `THIRD_PARTY_NOTICES` change is needed for them. Add a line to `docs/PROVENANCE.md` only if the file tracks runtime-loaded assets; check it.

## 3. Emoji

- Use `@tiptap/extension-emoji` (MIT): `:shortcode:` input rules and a `:` suggestion list.
  - Render the suggestion with the same `AnchoredPopup` pattern as the slash menu.
  - It opens after `:` plus 2 characters.
- **Toolbar:** a smiley button that opens an emoji picker popover:
  - a search box;
  - category tabs (Smileys, People, Nature, Food, Activities, Travel, Objects, Symbols, Flags);
  - an 8-column grid;
  - "Recently used" (up to 16, in `localStorage`, wrapped in try/catch).

  Build the grid from the extension's emoji data; no second emoji library. Store emoji as Unicode text, not image nodes (`enableEmoticons: false`, no fallback images).

- Add "Emoji" to the "/" menu, opening the picker.

## 4. Images

### Storage and callables

The files-column pipeline is column-bound, so add a parallel, description-scoped path that reuses `lib/file-storage.ts` helpers (bucket adapter, board access checks):

- `requestDescriptionImageUpload({ boardId, itemId, fileName, contentType, size })`:
  - the caller can edit the board, and the item is active;
  - `contentType` is one of `image/png|jpeg|gif|webp`;
  - `size` is at most 10 MB (`DESCRIPTION_IMAGE_MAX_BYTES` in shared);
  - fewer than 50 images per item;
  - it returns a signed PUT URL for `boards/{b}/items/{i}/description/{fileId}`, valid for 10 minutes.
- `finalizeDescriptionImage({ boardId, itemId, fileId, fileName })`:
  - checks the object's metadata (size, image content type) and deletes it on rejection, as files do;
  - then sets `items/{i}.descriptionImages.<fileId> = { name, size, mimeType, uploadedAt, uploadedBy }` (a field path write, Admin SDK).
- `getDescriptionImageUrl({ boardId, itemId, fileId })`:
  - the caller can read the board, and the fileId is in `descriptionImages`;
  - it returns a signed GET URL valid for 1 hour.

Data and rules:

- Put the request and response zod schemas in `packages/shared/src/schemas/description-images.ts`.
- `descriptionImages` is a Functions-only map. The item rules' `hasOnly` lists already refuse it from clients: add a comment, and rules tests for create, update and remove.
- `storage.rules` already denies all client access. No change.
- **Orphan sweep:** extend `sweepOrphanUploads` to also match `boards/{b}/items/{i}/description/{fileId}`, where "referenced" means present in `descriptionImages`.
- Known limit: an image deleted from the doc stays in Storage and in `descriptionImages` until a later cleanup pass. Note it in architecture.md.

### Editor

- Use `@tiptap/extension-image` (MIT), extended. Store the attributes `{ fileId, alt, width }`, and **no `src`** in the doc.
  - A React node view resolves the src through `useDescriptionImageUrl(boardId, itemId, fileId)`. It calls the callable, caches per fileId in memory until about 5 minutes before expiry, and refreshes on expiry or on an `<img>` error, once.
  - States: loading (a skeleton at the stored aspect ratio, or 16:9), ready, unavailable ("Image unavailable" with an icon).
- **Insert:**
  - the toolbar image button opens a file picker;
  - paste or drop image files into the editor;
  - "Image" is added to the "/" menu.

  Each one inserts a placeholder node with upload progress, using XHR progress on the signed PUT. On finalize it becomes a real image node; on error the placeholder is removed and the callable's message is shown as a toast.

- **Resize:** drag handles on the selected image set `width` as a percentage (25–100%), and click to select. No captions in this pass.
- Read-only viewers see images, but no handles or upload controls.
- `DescriptionEditor` needs `boardId` and `itemId` props; the item view passes them.
- `docToText`: images contribute their `alt`, if any.
- The doc-size check is unaffected, because images store only ids.

## 5. Toolbar order after pass 2

Undo, Redo | Text style, **Font** | B, I, U, S, **Colour** | lists | Link, **Image**, **Emoji**, More | Expand

## Dependencies

- `@tiptap/extension-text-style`, `@tiptap/extension-highlight`, `@tiptap/extension-emoji` and `@tiptap/extension-image`, all ^3.32.0 and MIT.
- Run `pnpm licenses:notices`.

## Tests

- **Unit (web):**
  - colour and highlight set a key and render `data-color` / `data-highlight`;
  - pasting HTML with inline `style="color:#f00"` keeps the text and drops the colour;
  - the font picker sets the key and `ensureFontLoaded` injects one link per family;
  - the emoji picker inserts an emoji, and `:smile` suggests;
  - the image node view goes through loading, ready and unavailable (mocked callable);
  - paste of an image file starts an upload (mocked);
  - clear formatting removes colour and font.
- **Functions:** unit tests for the three callables' logic with fakes, like `file-storage.test.ts`:
  - access denied for viewers on upload;
  - wrong type or too big is rejected;
  - finalize with a missing object is rejected;
  - finalize writes the field path;
  - `getDescriptionImageUrl` for an unknown fileId is rejected;
  - the sweeper deletes unreferenced description objects.
- **Rules:** a client can't write `descriptionImages`.
- **Visual:**
  - extend the full-view seed with a coloured word, a highlighted word, a Lora paragraph and an emoji;
  - add screens for the colour popover and the emoji picker, light and dark;
  - images need signed URLs, so cover them in unit tests, not visual tests, unless the visual harness stubs the callable.

## Out of scope

@mentions (pass 3), image captions, galleries, and video embeds.
