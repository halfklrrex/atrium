# 2026-11-17 Claude: docs PR 5, images in docs (`claude/docs-5-images`)

Spec: `docs/specs/P7-docs-editor.md` (PR 5). Code by a Sonnet 5.5 subagent.

## What changed

- **Shared** (`packages/shared/src/schemas/doc-images.ts`): request and result schemas, callable name constants, `docImagesSchema`, `DOC_IMAGE_MAX_BYTES`, `DOC_IMAGE_MAX_PER_DOC` (= `DOC_LIMITS.images`, 100). Entries reuse the description image entry shape.
- **Functions**: `requestDocImageUpload`, `finalizeDocImage`, `getDocImageUrl` (`callable/`, logic in `lib/doc-images.ts`, adapter `adminDocImageTx` in `lib/admin.ts`). Path `docs/{docId}/images/{fileId}`; the map `docs/{docId}/content/images` is written with `set` + merge on one key. Role check is `resolveBoardRole` on the doc with the workspace role (editors write, readers read); a deleted doc refuses all three. Default memory, no `minInstances`.
- **Sweeper**: `sweepOrphanUploads` handles `docs/{d}/images/{id}` through an optional `isDocImageReferenced` on the store; `purgeOrphanUploads` lists both `boards/` and `docs/`.
- **Web**: `ImageContext` is now `{ boardId, itemId } | { docId }` (`description-image-url.ts`: `imageContextOf`, `resolveImageUrl`, `seedImageUrl`, `useImageUrl`; `useDescriptionImageUrl` stays as a wrapper). Upload code picks the doc or item callables; extension options gained `docId`. `DocPage` passes `images={{ docId }}` always (a read-only editor ignores paste and drop but its image nodes need the scope). `docImageCalls` in `lib/callables.ts`.
- No rules change: the `images` part was already client read-only and tested in PR 1 (`tests/rules/src/docs.test.ts`).
- Tests: `functions/src/lib/doc-images.test.ts`, `packages/shared/.../doc-images.test.ts`, `components/rich-doc/RichDocEditor.images.test.tsx` (viewer sees the image, local preview, parallel paste order, description path unchanged). Existing description tests unchanged and green.

## Gotchas

- After deploy, check that `requestDocImageUpload`, `finalizeDocImage` and `getDocImageUrl` each have their public invoker binding (AGENTS.md deploy gotcha).
- No visual baseline changes (no screen changed; the emulator has no Storage).
- Like description images, an image deleted from a doc stays in Storage and the map until the doc is purged; it counts toward the 100.
