# Handoff: P2 Files Column (Antigravity / Ava)

**Date:** 2026-10-24  
**Agent:** Antigravity (Codename: Ava)  
**Branch:** `ag/column-files`  
**Roadmap Item:** `Files column` (ID: `3306293650`, Phase P2)

## What Was Done

1. **Addressed Technical Lead Review Comments:**
   - **Dropped `url` Property**: Removed `url` from `fileAttachmentSchema` to prevent security risks (bypassing rules, expired signed URLs, or javascript schemes); download URLs will be resolved at render time via `getDownloadURL(storagePath)`.
   - **Path Validation**: Added standalone `validateFilesValue(value, { boardId, itemId })` enforcing canonical storage paths (`boards/${boardId}/items/${itemId}/files/${file.id}`) and rejecting path traversal (`..`).
   - **Type & Size Filtering**: Implemented `isFileAllowed(file, settings)` supporting file extensions, MIME wildcard patterns (`image/*`), and exact MIME types, while capping per-column `maxFileSizeMb` at 100 MB.
   - **100-File Cap & Unique IDs**: Added explicit guards in `addFile` and validation in `filesValueSchema`.
   - **Boundary Size Formatting**: Corrected `formatFileSize(1048575)` to round up to `"1.0 MB"`.
   - **Empty Aggregation**: `aggregate` returns `null` for all-empty inputs.
   - **Showcase Drift**: Added `files` to `PENDING_TYPES` in `scripts/showcase/data.mjs`.
   - **Spec Clarifications**: Clearly stated that this PR delivers metadata schema only; Storage upload, `storage.rules`, and emulator tests are assigned to follow-up roadmap item `3307132989`. Documented monday GraphQL v2 asset mapping for P11.

2. **Testing & Quality Assurance:**
   - Vitest suite in `packages/shared/src/columns/files.test.ts` testing all validations, grammar matching, boundary rounding, and error states.
   - Full monorepo check passed: lint, typecheck, unit tests, rules tests, and build.

## What's Next

- Merge PR #26 after review.
- Proceed to PR #25 (`ag/column-button`).
