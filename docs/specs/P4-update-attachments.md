# P4: Attachments in item updates

Author: Ophelia · Implementers: Sonnet 5.5 (medium effort) · Roadmap: "Attachments in item updates (attach icon in the composer)" (item 3333534435) · Builds on: `P2-files-storage-upload.md`, `VF9-update-composer-fidelity.md` (Out of scope), the description images callables · Status: **approved by the owner's feature request (2026-11-05); the open questions below have defaults that stand.**

## Goal

A person can attach files to an update (and to a reply) from the composer's attach icon, see them under the post, download them, and remove their own. Storage stays closed to clients: every upload and download goes through callables with short-lived signed URLs, exactly like the Files column and description images.

## Facts this design rests on

- `storage.rules` deny every client read and write; Storage rules can't read the named Firestore database (`docs/architecture.md` section 2.1).
- The Files column flow is two steps: `requestFileUpload` (signed V4 PUT URL with a content-length range) then `finalizeFileUpload` (verifies the object, then commits the metadata in a transaction); deletes happen after the commit; `purgeOrphanUploads` sweeps unreferenced objects daily.
- Updates live in `boards/{boardId}/items/{itemId}/updates/{updateId}` (replies in a `replies` subcollection). Their documents are written by the client today, under rules (`firestore.rules`, the `updates` match).
- `isFileAllowed` and the file-type and size limits live in `packages/shared` (Files column).

## Design

### Data

- An update (and a reply) gets an optional `attachments: Attachment[]` (max 10), each `{ fileId, name, size, contentType, uploadedAt, uploadedBy }`, the same shape as the Files column's attachment (reuse its zod schema; add no new fields).
- **Server-managed:** clients never write `attachments`. It is in neither the create nor the update key list of the `updates` and `replies` rules, so a client can't forge a file reference; only the finalize callable (Admin SDK) writes it, in a transaction. A client-created update starts without it.
- Storage layout: `boards/{boardId}/items/{itemId}/updates/{updateId}/{fileId}` (replies: `.../updates/{updateId}/replies/{replyId}/{fileId}`).

### Flow (callables, europe-west1, database `atrium-1`)

1. **The update exists first.** The composer posts the update text as today, then uploads the chosen files against the new update (so there is always a document to attach to and to authorise against). A post with files shows them as "uploading" chips under it until finalized; a failed upload leaves the post and shows a retry on the chip.
2. `requestUpdateAttachmentUpload({ boardId, itemId, updateId, replyId?, fileName, contentType, size })`: caller must be the update's (reply's) **author** and have edit access to the board; update/reply exists, item active, fewer than 10 attachments; `isFileAllowed` and the 25 MB cap (smaller than the Files column's 100 MB); returns a signed V4 PUT URL (10 min, `x-goog-content-length-range`), `fileId`, headers.
3. `finalizeUpdateAttachment({ …, fileId, fileName })`: verifies the object (size, content type, created time), then in one transaction appends the attachment to `attachments` (re-checks the cap); on failure deletes the object after the transaction.
4. `getUpdateAttachmentUrl({ boardId, itemId, updateId, replyId?, fileId })`: any board reader (owner, editor, viewer); the file must be listed on the update; returns a 5 minute signed GET URL with `Content-Disposition` set from the stored name (images may be shown inline by the web through the same URL).
5. `deleteUpdateAttachment({ …, fileId })`: the author (or a board owner) removes it: transaction removes the entry, object deleted after commit.
6. **Cleanup:** deleting an update or reply (client delete today) must not orphan files. Extend the existing orphan sweeper `purgeOrphanUploads` to also treat `updates/**` objects as referenced only if the update/reply document lists the `fileId`; an hour-old unreferenced object is deleted. Check how the sweeper resolves references for item files and mirror it. When an item is trashed and later purged, `purgeTrash` already removes `boards/{id}/items/{id}/` content: confirm it covers the `updates/` prefix and extend it if not.

### Web

- The composer's attach icon (hidden today, see VF9) comes back in the bottom row, left, after `@`. It opens the file picker (multiple); chosen files show as removable chips above the footer until posted; drag-and-drop onto the composer is a nice-to-have, skip it.
- Under a post: a row of attachment chips (icon by type, name, size); images show a small thumbnail through `getUpdateAttachmentUrl`; click downloads. The author sees a remove (x) control on their own chips. Tokens only, Vibe components, light and dark, compared with monday's update attachments.
- Errors name the cause (too large, type not allowed, limit of 10) through `describeCallableError`.

## Out of scope

- Drag and drop, paste-image-into-composer, previews beyond a thumbnail, attachments in notifications or the activity log text (an `attachments_added` activity line is not needed).
- Virus scanning (family and friends app, same as the Files column).

## Open questions for the owner (defaults in bold)

1. Maximum size per file: **25 MB** (Files column allows 100 MB).
2. Maximum files per update or reply: **10**.
3. Same allowed types as the Files column: **yes**.
4. Can a board owner remove someone else's attachment: **yes** (the author and board owners).

## PR split

1. **Backend (shared, rules, functions):** attachment schema reuse, `attachments` kept out of the client key lists with rules tests, the four callables with unit tests, sweeper and purge changes with tests.
2. **Web:** composer attach button and chips, post-then-upload flow, feed and reply rendering, remove, tests, showcase and owner check-list entry.

## Tests that must exist

- Rules: a client can't create or update an update or reply with `attachments`; existing update writes still work.
- Callables: author-only request, non-author refused, viewer can download but not request, cap and size and type checks, finalize verifies and appends once (repeat is a no-op), delete by author and by board owner, a removed attachment's object is deleted after the commit.
- Sweeper: an unreferenced update object older than an hour is deleted; a referenced one is kept.
- Web: attach, post, upload chips, failure and retry, remove, thumbnail, errors.

## Definition of done

The five checks pass, CI is green including `visual`, attaching a file to an update works on the showcase board in production, the Roadmap item is In review with Actionable = Yes and an entry in `docs/plans/owner-check-list.md`.
