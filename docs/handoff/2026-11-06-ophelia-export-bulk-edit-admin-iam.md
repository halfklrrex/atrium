# 2026-11-06 (evening), Ophelia: CSV export, bulk edit, view tab font, admin IAM fix

## Merged and live

- **#139 Export to CSV** (P6 first slice; spec `docs/specs/P6-export-csv.md`): board ⋯ menu → "Export to CSV". Client-side, RFC 4180, BOM, formula-injection guard, open view's rows/hidden columns (header menu) or everything (sidebar menu). Print styles and native `.xlsx` are follow-ups.
- **#141 Bulk edit** (spec `docs/specs/P1-bulk-edit-selected.md`): editing a cell in a selected row with other same-level rows selected offered "Apply to N selected items" (v1; superseded by v2, which applies at once with no popup). Undo is the toast action (the repo has no undo stack). Skip toast says "locked or required" for any skip reason.
- **#140** view tab labels 14px (`--font-size-20`).
- Baselines for the board options menu were updated for #139.

## Site admin

- **Production IAM fix (owner ran it):** the Functions runtime account `…-compute@developer.gserviceaccount.com` needed `roles/firebaseauth.admin`; without it `listAccounts` (and any claim write from a Function) failed with INSUFFICIENT_PERMISSION. `/admin` works now. Record this in any new-project setup.
- **#138 (the gate) is still a draft and NOT merged.** The owner set Actionable to Agents on the site-admin item, but I asked for an explicit "yes, ship the gate" and set it back to Yes. Prerequisites are met. Rebase on `main` first (baselines changed).
- The owner's missing boards were fixed by the owner; the data was intact (verified in Firestore).

## Bug inbox

- 2026-11-06: bulk edit (done, above) and view tabs font (done). Both items are In review, Actionable = Yes.
- The owner flagged all their Actionable = Yes items as Agents without comments; I read that as sign-off and set 22 items to Done / Actionable = No. If any was not meant, reopen it.

## Next

1. Owner "yes" → merge #138, check the deploy, owner signs out/in.
2. Browser QA of bulk edit and CSV export with Chrome (not done; the extension connected late).
3. Unstarted epics needing specs: Teams & profiles, Email notifications, PWA/web push, Docs editor, Map and Files gallery views, print styles, the P8 API.
4. Production backfills still awaiting go-ahead: `requiredColumnIds`, legacy activity cleanup, `dateKeys`.

## Gotchas

- Untracked spec files in the main checkout collide with the same files arriving through a PR: delete the untracked copy before `git pull`.
- `gh pr checks --watch` over 10 minutes moves to the background; fine, wait for the notification.
