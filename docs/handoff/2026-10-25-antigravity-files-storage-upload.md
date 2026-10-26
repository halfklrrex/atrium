# Handoff: Files Storage Upload, Rules & Tests (P2)

**Date:** 2026-10-25  
**Agent:** Ava (Antigravity)  
**Role:** Pair Developer  
**Lead:** Ophelia (Claude Opus 5.5)  
**Task / Roadmap ID:** `3307132989` — Files: Storage upload, storage.rules + emulator tests  
**Branch:** `ag/files-storage-upload`

---

## 1. What was done

1. **Architecture & Specification:**
   - Updated specification [`docs/specs/P2-files-storage-upload.md`](file:///D:/DevProjects/Atrium/atrium-ag/docs/specs/P2-files-storage-upload.md) detailing storage path hierarchy, rules invariants (complete direct client deny per DB1 findings on named databases), signed URL upload/download/delete callable lifecycles, and emulator testing strategy.

2. **Storage Security Rules (`storage.rules`):**
   - Implemented strict deny across all paths (`allow read, write: if false;`), closing direct client read, upload, and deletion holes.
   - Enforced mediation of all storage access through Cloud Functions callables using short-lived V4 signed URLs.

3. **Shared Column Schemas & Registry (`packages/shared`):**
   - `packages/shared/src/schemas/files-upload.ts`:
     - Added `safeIdSchema` (`^[A-Za-z0-9_-]{1,128}$`).
     - Added request and result schemas for `requestFileUpload`, `finalizeFileUpload`, `getFileDownloadUrl`, and `deleteFileAttachment`.
   - Updated `resolveBoardRole` to strictly require workspace membership before evaluating explicit access entries.

4. **Backend Cloud Functions (`functions`):**
   - Implemented transaction core logic in `functions/src/lib/file-storage.ts`:
     - `requestFileUploadInTransaction`: Verifies board edit rights via `resolveBoardRole`, validates file size against column `maxFileSizeMb` and 100 MB global limit, validates MIME type/extension via `isFileAllowed`, generates safe `fileId`, and creates a 10-minute V4 signed upload URL.
     - `finalizeFileUploadInTransaction`: Verifies uploaded object metadata directly in GCS, deletes object if validation fails, and commits `FileAttachment` to Firestore `values.<columnId>`.
     - `getFileDownloadUrlInTransaction`: Validates board read permissions (`owner`, `editor`, `viewer`), verifies file presence in cell, and generates a 5-minute V4 signed GET URL.
     - `deleteFileAttachmentInTransaction`: Commits file removal from item values in Firestore first, then deletes the underlying object from Storage.
   - Updated `adminFileStorageTx` to update via `new FieldPath('values', colId)`.
   - Updated `adminFileStorageBucket` to issue V4 signed upload and download URLs.
   - Exported callable endpoints in `functions/src/index.ts`:
     - `requestFileUpload`
     - `finalizeFileUpload`
     - `getFileDownloadUrl`
     - `deleteFileAttachment`
     - `uploadFileAttachment` (alias)
   - Unit tests: 10 comprehensive unit tests in `functions/src/lib/file-storage.test.ts` covering upload request, finalization, download URL issuance, and deletion.

5. **Storage Rules Emulator Test Suite (`tests/rules`):**
   - Fixed `tests/rules/src/helpers.ts` Proxy wrapper.
   - Updated `tests/rules/src/storage.test.ts` testing strict deny across unauthenticated, authenticated owner, admin, member, viewer, and outsider roles (130 total rules tests passing).

6. **Documentation & Deployment:**
   - Added Cloud Functions runtime SA IAM requirements (`roles/iam.serviceAccountTokenCreator`, `roles/storage.objectAdmin`) to `docs/DEPLOY.md`.

---

## 2. What's next

- Set Roadmap item `3307132989` to **Pending Merge**.
- Rebase and address review comments on PR #22 (`ag/formula-column`), PR #10 (`ag/board-filters-sort`), and PR #11 (`ag/realtime-sync-optimistic`).
