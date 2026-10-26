# P1c: Real-time sync & optimistic UI

Author: Antigravity · Implementer: Antigravity · Roadmap: P1 "Real-time sync & optimistic UI" · Branch: `ag/realtime-sync-optimistic`

## Summary

This epic provides robust real-time synchronisation, offline resilience, and live presence indicators across Atrium boards:

1. **Offline Persistence:** Firestore IndexedDB cache persistence with multi-tab coordination (`persistentLocalCache` + `persistentMultipleTabManager`).
2. **Network State Awareness:** Hook `useOnlineStatus` detecting online/offline transitions, presenting a top status banner or subtle alert when offline.
3. **Live Presence System:** Tracks active viewers on a board in real time (`boards/{boardId}/presence/{uid}`), displaying their avatars in the board header with automatic heartbeat and timeout.
4. **Optimistic Cell Writes (Adopted from P1b):** Cell writes utilize field-path updates (`values.<colId>`) with local optimistic updates and automatic rollback on error via `apps/web/src/data/item-writes.ts`. Rather than introducing a duplicate generic optimistic layer, this spec standardizes on P1b's `item-writes.ts`.

---

## 1. Offline Persistence (`apps/web/src/lib/firebase.ts`)

- Firestore client initializes `persistentLocalCache` with `persistentMultipleTabManager()`, enabling IndexedDB persistence across multiple browser tabs so edits survive offline reloads.
- Falls back to `memoryLocalCache()` when IndexedDB is unavailable (e.g. node/jsdom test environments).
- Named database `FIRESTORE_DATABASE_ID` (`atrium-1`) is always supplied across all initialization paths.
- P1b's `item-writes.ts` (field-path updates with rollback) combined with Firestore's built-in latency compensation provide full optimistic UI coverage.

---

## 2. Presence Subcollection & Data Model

### Collection: `boards/{boardId}/presence/{uid}`

```ts
interface BoardPresence {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  lastActiveAt: Timestamp;
  expiresAt: Timestamp;
}
```

### Heartbeat Lifecycle & TTL Policy

- Hook: `useBoardPresence(boardId, currentUser)`
- When viewing a board:
  - Write current user's presence doc (`setDoc` with `lastActiveAt: serverTimestamp()`, `expiresAt: Date.now() + 1 hour`).
  - Send heartbeat every 30 seconds (`PRESENCE_HEARTBEAT_INTERVAL_MS`).
  - Skip heartbeat writes while `!navigator.onLine` or `document.hidden`.
  - Re-send immediately on `visibilitychange` (tab becomes visible) or `online` event.
  - Delete presence doc on unmount / `beforeunload` navigation away (`deleteBoardPresence`).
- Active threshold: Viewers with `lastActiveAt` within the last 60 seconds (`PRESENCE_ACTIVE_THRESHOLD_MS`) are considered active; local clock tick filters out stale entries in memory.
- Server TTL Policy: Configured in `firestore.indexes.json` under `fieldOverrides` on collection group `presence` for field `expiresAt` (`ttl: true`). Firestore deletes expired documents automatically.

---

## 3. UI Components

1. **`PresenceAvatars.tsx` (`apps/web/src/components/presence/`):**
   - Renders in `BoardHeader.tsx` next to member avatars.
   - Uses Vibe's `AvatarGroup` (max 3 avatars with overflow counter).
   - Tooltip shows "Viewing now: Avery, Alice, ...".
   - Automatically hides the avatar group when there are no viewers, or when you are the only viewer (matching monday.com fidelity).
2. **`OfflineNotice.tsx` (`apps/web/src/components/OfflineNotice/`):**
   - Banner displayed when `navigator.onLine === false`.
   - Copy: "You're offline. Changes will sync when you reconnect."
   - Styled with Vibe `AlertBanner` using `warning` background and positioned at `z-index: var(--atrium-z-toast)`.

---

## 4. Firestore Security Rules (`firestore.rules`)

Strict presence rules enforced:

1. Caller must be signed in and authorized to view the board (`canReadBoard(boardId)`).
2. Users can only write their own document (`uid() == presenceUid`).
3. Payload is schema- and size-bounded (only `uid`, `displayName`, `photoURL`, `lastActiveAt`, `expiresAt` allowed; string sizes bounded).
4. Identity is bound directly to auth token claims: `d.displayName == request.auth.token.get('name', null)` and `d.photoURL == request.auth.token.get('picture', null)`.
5. `lastActiveAt` must be set using `request.time` (server timestamp).
6. `expiresAt` must be a timestamp within 1 hour (+2m grace) of `request.time`.

```javascript
match /presence/{presenceUid} {
  function validPresence(d) {
    return d.keys().hasAll(['uid', 'lastActiveAt', 'expiresAt'])
      && d.keys().hasOnly(['uid', 'displayName', 'photoURL', 'lastActiveAt', 'expiresAt'])
      && d.uid == uid()
      && d.get('displayName', null) == request.auth.token.get('name', null)
      && d.get('photoURL', null) == request.auth.token.get('picture', null)
      && (d.get('displayName', null) == null || (d.displayName is string && d.displayName.size() <= 100))
      && (d.get('photoURL', null) == null || (d.photoURL is string && d.photoURL.size() <= 2000))
      && d.lastActiveAt == request.time
      && d.expiresAt is timestamp
      && d.expiresAt >= request.time
      && d.expiresAt <= request.time + duration.value(1, 'h') + duration.value(2, 'm');
  }

  allow read: if signedIn() && canReadBoard(boardId);
  allow create, update: if signedIn() && canReadBoard(boardId) && uid() == presenceUid
    && validPresence(request.resource.data);
  allow delete: if signedIn() && canReadBoard(boardId) && uid() == presenceUid;
}
```

---

## 5. Verification & Tests

- Unit tests for presence time threshold calculations and presence store.
- Rules tests for presence reading and writing.
- Component tests for `PresenceAvatars` and `OfflineNotice`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build` pass.
