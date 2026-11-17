# 2026-11-17 Claude: docs PR 4, sharing and purge (`claude/docs-4-share-purge`)

Spec: `docs/specs/P7-docs-editor.md` (PR 4). Code by a Sonnet 5.5 subagent.

## What changed

- **`functions/src/lib/entity-sharing.ts`**: the role and cap logic of dashboard sharing, parameterized by a noun ("dashboard", "doc") and the access cap (`setEntityAccessInTransaction`, `EntitySharingTx`). `dashboard-sharing.ts` is now a thin adapter with the same exports and the same messages; `dashboard-sharing.test.ts` is unchanged and green.
- **`setDocAccess`** callable (`functions/src/callable/setDocAccess.ts`, `adminDocSharingTx` in `lib/admin.ts`), request schema `setDocAccessRequestSchema` and `SET_DOC_ACCESS_CALLABLE` next to the dashboard ones. Region and options are the defaults of the other callables (no `minInstances`).
- **Purge**: `purgeTrashLogic` also finds docs with `state == 'deleted'` and `deletedAt <= cutoff`, clears the Storage prefix `docs/{id}/` first, then `recursiveDelete`s `docs/{id}` (body, images map, presence). Result gains `docsPurged`. `deleteStoragePrefix` accepts `boards/` and `docs/` prefixes.
- **Web**: `ShareEntityDialog` (`components/sharing/`) with `kind: 'dashboard' | 'doc'`; `ShareDashboardDialog` is a wrapper, same ids, labels and texts as before. `docWrites.setDocSharing`, `docSharingCalls`, dialog type `shareDoc`, and a **Share** button in the doc page header (owners, not in the trash).

## Gotchas

- After deploy, check that `setDocAccess` has its public invoker binding (AGENTS.md deploy gotcha).
- The doc page header gained a button, so `doc-page-*` and `doc-conflict-banner-*` baselines change on purpose. Dashboard and board share baselines must not change.
- `purgeTrash` queries docs with `state ==` plus `deletedAt <=`, which needs a composite index like boards and items have: added to `firestore.indexes.json` (`docs`, `state` + `deletedAt`). It deploys with the rules and indexes; until it is built the purge run errors on that query.
