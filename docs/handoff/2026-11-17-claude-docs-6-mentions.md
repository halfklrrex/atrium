# 2026-11-17 · Claude (Sonnet subagent) · Docs editor PR 6: mention notifications

Branch `claude/docs-6-mentions`, spec `docs/specs/P7-docs-editor.md` (PR 6 section).

## Done

- `onDocBodyWritten` (`onDocumentWritten` on `docs/{docId}/content/body`, `FIRESTORE_DATABASE_ID`, `europe-west1`, `retry: true`) calls `notifyDocMentions` in `functions/src/lib/notifications.ts`: diffs `mentionedUidsOf` before and after, skips the actor, trashed or missing docs, people who can't read the doc (`resolveBoardRole` on the doc's `kind`/`access`) and people with the `mention` pref off, at most 20 per save, id `mention-<eventId>-<uid>` with `create` (a retry overwrites nothing).
- `notificationSchema` gains optional `docId` and `docName`. A doc mention stores the doc id in `boardId` and `itemId` too (both are required, non-empty ids), with empty `boardName` and `itemName`.
- The bell card says "Mentioned you in a doc", shows the doc name instead of item and board, and opens `docPath`. Push: title "mentioned you in a doc", body the snippet or doc name, URL `/docs/<id>`, tag `doc-<id>`.
- "@" suggestions in docs were already wired in PR 2 (`docMentionSource`).

## Notes

- No rules change: notification creates are Functions-only and the recipient may only touch `readAt`, so no new rules test.
- No visual baseline changes (no screen changed).
- The first save of a brand-new doc body mentions people already in it; that is intended (they are new).
- After deploy, check the trigger exists on `atrium-1` and the Eventarc binding is fine like the other triggers.
