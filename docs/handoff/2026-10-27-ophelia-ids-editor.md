# 2026-10-27: Ophelia (Opus 5.5): numeric item IDs, description editor passes 1 and 2, checklist fix

## What was done

- **Session start:**
  - No open PRs.
  - Closed seven owner sign-offs on the Roadmap.
  - Answered the bug inbox. The owner's request for a richer description editor became three Roadmap items: passes 1–3.
- **PR #14:** description checklist alignment, merged and deployed.
  - Root cause: a paragraph margin inside each list item.
  - Added the tokens `--atrium-doc-line-height` and `--atrium-doc-checkbox-size`.
- **PR #15:** short numeric item IDs and server-assigned auto numbers, merged and deployed. Spec: `docs/specs/P2-numeric-item-ids.md`.
  - The `onItemCreated` trigger assigns `seq` (account-wide) and `boardSeq` (per board, with subitems counted separately).
  - `auto_number` is now derived.
  - Sort, filter and search use computed values for every derived column.
  - **Production runs (done, with the owner's go-ahead):**
    - `2026-10-backfill-item-seq.mjs --apply` numbered 45 items;
    - `2026-10-backfill-derived-column-ids.mjs --apply` updated `showcase-main`;
    - the showcase upsert kept the numbers.
  - Checked live on the showcase: plain, centred numbers.
  - Decision logged on the Decisions board.
- **PR #16:** description editor pass 1, merged and deployed. Spec: `docs/specs/P1-description-editor-pass1.md`.
  - Toolbar, "/" menu (`@tiptap/suggestion`), tables (`TableKit`), and expand mode (one editor instance, moved with a portal).
  - Headings now use Figtree 700, after the owner flagged the Poppins headings.
- **PR #18:** description editor pass 2, merged and deployed. Spec: `docs/specs/P1-description-editor-pass2.md`.
  - Text colour and highlight: 10 keys each. The doc stores keys and `theme/editor-tokens.css` maps them per theme; a contrast test covers it.
  - Font picker with 7 keys, loaded lazily from Google Fonts.
  - Emoji: `@tiptap/extension-emoji` plus a picker.
  - Description images: three callables, `items.descriptionImages` (Functions only), signed URLs, and the orphan sweep extended.
  - **Security fix found in review:** the image request schemas used `idSchema`, which allows `/` and `..`. A crafted `fileId` could have made finalize delete another Storage object. They now use `safeIdSchema`, plus a path-segment guard.
  - **Live check:** image uploads fail. The bucket has **no CORS config**, so the browser's signed PUT is refused. This also affects files-column uploads. Logged as a bug for the owner, with exact `gcloud storage buckets update --cors-file` steps, because CORS is a security setting.

## Gotchas

- **Two deploy failures, both fixed by re-running only the failed jobs:**
  - the flaky `membership.test.tsx:306` (logged as a bug);
  - a Cloud Run "Quota exceeded for total allowable CPU per project per region" while every function redeployed at once. It happened twice (PRs #15 and #18), so it's logged as a High bug.
- **Unit tests with mocked callables can't catch infrastructure gaps** like bucket CORS. Do one real end-to-end upload after any Storage change.
- **jsdom can't catch everything in the editor.** The table scroll class crashed the editor only in a real browser, and the visual workflow showed it as "item view dialog not found". Always generate the Linux baselines before opening an editor PR.
- **Visual screens share one seeded description.** A screen that types into it must restore it, or later screens change. See the slash-menu screen.
- **Auto mode's safety check sometimes returns no verdict.** It's transient; retry later.

## Next

- **Owner checks (Actionable = Yes):**
  - the checklist bug, numeric IDs, and editor passes 1 and 2;
  - **the bucket CORS steps:** item "🐞 Uploads blocked: Storage bucket has no CORS rule".
- **Once the owner has applied CORS:** re-test an image paste and a files-column upload live, then commit `storage-cors.json` for reference.
- **Bug (High):** the Cloud Run CPU quota on deploys. Check the quota, then lower `maxInstances` per function or ask the owner for a quota increase.
- **Bug:** fix the flaky MembersDialog test (`pickMenuAction` waits).
- **VF:** measure monday's description editor, then do the gap pass. That includes the toolbar wrapping to two rows and the emoji search label.
- **Description editor pass 3 (@mentions):** waits on P4 notifications.
