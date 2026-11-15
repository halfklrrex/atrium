# Paste screenshots into updates and replies

Owner request (bug inbox, 2026-11-14): pasting screenshots should work in comments/updates (and descriptions, etc.), like in monday.

## Current state

- The description editor already handles paste and drop of image files (`apps/web/src/components/item-view/editor-images.ts`, `description-image-upload.ts`, `description-image-url.ts`): the doc stores `{ fileId, alt, width }`, never a `src`, and the node view asks the server for a signed URL.
- The update/reply composer (`apps/web/src/components/item-card/composer-extensions.ts`) deliberately leaves images out ("images and uploads"). Item-file attachments exist on updates (see `UpdatesFeed.tsx`).

## Behaviour

- Pasting (or dropping) an image file into the update composer or a reply composer uploads it and shows it inline in the composer; sending the update stores and renders it inline in the feed, for every viewer allowed to see the item.
- Reuse the description image pipeline (upload, signed URL, node view, size/type limits, error toasts) rather than building a second one. Prefer the simplest design that reuses the same storage path scheme and server function; document the choice in the PR.
- Edit, delete and the realtime feed keep working. Deleting an update must not leave its images reachable by another user; follow however description images are cleaned up and say what you did.
- Check the other rich-text surfaces that still ignore paste (item names are plain text, skip them). If any other editor that should take images lacks it, report it, do not widen scope silently.

## Rules

- Security: Storage and Firestore rules plus emulator tests for any new path or field before it ships. Never loosen rules. Remember Storage rules cannot read the named Firestore database (AGENTS.md).
- Update schema changes go through `packages/shared` (hot spot, keep minimal) with zod and the MCP/update read paths kept consistent.
- Tokens only for styling. Tests for paste, upload failure and render. Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build`.
