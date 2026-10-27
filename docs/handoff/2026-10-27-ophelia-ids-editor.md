# 2026-10-27: Ophelia (Opus 5.5): numeric item IDs, description editor pass 1, checklist fix

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

## Gotchas

- **Two deploy failures, both fixed by re-running only the failed jobs:**
  - the flaky `membership.test.tsx:306` (logged as a bug);
  - a Cloud Run "Quota exceeded for total allowable CPU per project per region" while every function redeployed at once.
- **jsdom can't catch everything in the editor.** The table scroll class crashed the editor only in a real browser, and the visual workflow showed it as "item view dialog not found". Always generate the Linux baselines before opening an editor PR.
- **Visual screens share one seeded description.** A screen that types into it must restore it, or later screens change. See the slash-menu screen.
- **Auto mode's safety check sometimes returns no verdict.** It's transient; retry later.

## Next

- **Owner checks (Actionable = Yes):** the checklist bug, numeric IDs, and editor pass 1.
- **Description editor pass 2:**
  - colours and emoji;
  - images through the signed-URL pipeline;
  - a font picker: Default (Figtree), Figtree, Poppins (the owner's request), Lora, Nunito, JetBrains Mono and Caveat, loaded on demand. The plan is recorded on the Roadmap item.
- **New VF item:** measure monday's description editor, then a gap pass.
- **Bug:** fix the flaky MembersDialog test (`pickMenuAction` waits).
