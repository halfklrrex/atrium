# 2026-10-24 · Antigravity · Real-time sync & optimistic UI (P1c)

Branch: `ag/realtime-sync-optimistic`
Roadmap item: Real-time sync & optimistic UI (Phase P1)
Spec: `docs/specs/P1c-realtime-sync-optimistic.md`

## What was done

1. **Offline Persistence (`apps/web/src/lib/firebase.ts`):**
   - Configured client Firestore initialization with `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` via `initializeFirestore`, passing `FIRESTORE_DATABASE_ID` (`atrium-1`).
   - Added graceful fallback to in-memory persistence (`memoryLocalCache()`) when persistent IndexedDB storage is restricted or unavailable (e.g., in node/testing environments or private browsing).
   - Optimistic half is fully covered by P1b's `item-writes.ts` combined with Firestore's latency compensation.

2. **Network State Indicator (`apps/web/src/components/OfflineNotice/`):**
   - Implemented `useOnlineStatus` hook subscribing to browser `online` and `offline` events using `useSyncExternalStore`.
   - Built `OfflineNotice` component rendering Vibe's `AlertBanner` (`backgroundColor="warning"`) with copy: "You're offline. Changes will sync when you reconnect."
   - Positioned at `z-index: var(--atrium-z-toast)`.
   - Integrated `<OfflineNotice />` at the top of `AppShell`.
   - Added full unit test coverage in `OfflineNotice.test.tsx`.

3. **Live Board Presence System (`apps/web/src/data/presence.ts` & `apps/web/src/components/presence/`):**
   - Subcollection: `boards/{boardId}/presence/{uid}` with schema `{ uid, displayName, photoURL, lastActiveAt, expiresAt }`.
   - Built `useBoardPresence(boardId, currentUser)`:
     - Sets presence immediately with `serverTimestamp()` and `expiresAt` (1h from now).
     - Maintains presence via 30s heartbeat interval, skipping writes while offline (`!navigator.onLine`) or hidden (`document.hidden`).
     - Refreshes heartbeat immediately when document becomes visible or comes back online.
     - Cleans up presence document on unmount and on `beforeunload`.
     - Real-time listener for active board viewers, filtering those within the 60s active threshold.
   - Built `PresenceAvatars` component using Vibe's `AvatarGroup` and `Avatar` with a live indicator dot and tooltip ("Viewing now: ...").
   - Automatically hides avatar group when user is the only active viewer (matching monday.com fidelity).
   - Integrated `PresenceAvatars` into `BoardHeader` action bar.
   - Added unit test suites for presence data thresholds, avatar group single-viewer hiding, and component behavior.

4. **Optimistic Cell Writes (Adopted from P1b):**
   - Standardized on P1b's `apps/web/src/data/item-writes.ts` for optimistic cell edits with field-path writes (`values.<colId>`), rollback on failure, and toast notifications.
   - Removed duplicate generic `apps/web/src/data/optimistic.ts`.

5. **Firestore Security Rules & TTL Strategy (`firestore.rules` & `tests/rules/`):**
   - Added rule for `boards/{boardId}/presence/{presenceUid}` allowing board readers to read presence and allowing users to write their own presence (`uid() == presenceUid && uid == request.auth.uid`) if they have board access.
   - Identity bound directly to auth token claims: `d.displayName == request.auth.token.get('name', null)` and `d.photoURL == request.auth.token.get('picture', null)`.
   - Enforced schema bounds and string lengths (`displayName` <= 100, `photoURL` <= 2000).
   - TTL policy declared in `firestore.indexes.json` under `fieldOverrides` on collectionGroup `presence` for `expiresAt` (`ttl: true`).
   - Rules enforce `lastActiveAt == request.time` and `expiresAt` within 1h (+2m grace) of `request.time`.
   - Added comprehensive negative test suite in `tests/rules/src/presence.test.ts` testing forged update/delete, backdated update, uid mutation, missing required fields, non-string types, and spoofed identity.

## Verification

- `pnpm lint`: clean (ESLint + Stylelint + Prettier).
- `pnpm typecheck`: clean across all packages.
- `pnpm test`: 100% passing (191 web tests, 244 shared tests, 20 functions tests).
- `pnpm test:rules`: 100% passing (142/142 tests against Firestore emulator).
- `pnpm build`: clean build across all projects.
