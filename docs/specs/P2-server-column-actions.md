# P2: Server-Side Column Actions (Time Tracking Start/Stop, Button Clicks)

**Epic:** Server-side column actions (time tracking start/stop, button clicks)  
**Roadmap Item:** `3307097019` (Phase P2: Full Column Library)  
**Author / Implementer:** Ava (Antigravity)  
**Branch:** `ag/server-column-actions`

---

## 1. Overview & Security Rationales

Client-only mutations for timer controls and button actions introduce trust and security issues:

1. **Clock Manipulation**: Clients can forge `startDate`, `startedAt`, or `duration` when starting or stopping timers, compromising billable hours, project tracking, and work audits.
2. **Identity Spoofing**: Clients could attribute timer sessions to other users rather than `request.auth.uid`.
3. **Audit Trail Integrity**: Button clicks must append an immutable event to `boards/{boardId}/activity` (which by architecture §5.6 is writable _only_ by Cloud Functions via the Admin SDK). This activity feed will subsequently trigger automation recipes in Phase P5.

To solve this, this epic provides three transactional Cloud Functions (2nd gen callables):

- `startTimeTracking`: starts a timer on an item using server clock and authenticated user ID.
- `stopTimeTracking`: stops an open timer, accurately calculates elapsed duration, and closes the session.
- `clickButton`: checks board edit permissions and appends an immutable button click event to `boards/{boardId}/activity`.

---

## 2. Shared Schemas (`@atrium/shared`)

### 2.1 Time Tracking Actions

```ts
export const startTimeTrackingRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    itemId: z.string().min(1).max(64),
    columnId: z.string().min(1).max(64),
    note: z.string().max(500).optional(),
  })
  .strict();

export const startTimeTrackingResultSchema = z
  .object({
    success: z.literal(true),
    sessionId: z.string().min(1),
    startedAt: z.number().int().positive(),
  })
  .strict();

export const stopTimeTrackingRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    itemId: z.string().min(1).max(64),
    columnId: z.string().min(1).max(64),
    /** Optional sessionId of the active session being stopped (allows idempotent retries). */
    sessionId: z.string().min(1).max(64).optional(),
  })
  .strict();

export const stopTimeTrackingResultSchema = z
  .object({
    success: z.literal(true),
    duration: z.number().int().min(0),
    stoppedAt: z.number().int().positive(),
  })
  .strict();
```

### 2.2 Button Click Action

```ts
export const clickButtonRequestSchema = z
  .object({
    boardId: z.string().min(1).max(64),
    itemId: z.string().min(1).max(64),
    columnId: z.string().min(1).max(64),
  })
  .strict();

export const clickButtonResultSchema = z
  .object({
    success: z.literal(true),
    activityId: z.string().min(1),
    timestamp: z.number().int().positive(),
  })
  .strict();
```

---

## 3. Transactional Logic & Invariants

### 3.1 Authorization Check

- Mirrors `firestore.rules`' `boardRole(board)` exactly via shared `resolveBoardRole`:
  - Workspace membership is required first; removed members with stale explicit `access` entries receive `null` and are rejected with `permission-denied`.
  - On private boards, explicit `board.access[uid]` is required; non-listed members/owners receive `null` and are denied.
  - On main boards, explicit access wins, otherwise role derives from workspace membership (`owner`/`admin` -> `owner`, `member` -> `editor`, `viewer` -> `viewer`).
  - Viewers and outsiders are rejected with `permission-denied`.

### 3.2 `startTimeTracking` Invariants

- Item must exist and have `state: 'active'`.
- Column must exist in `board.columns` and have `type: 'time_tracking'`.
- Validates stored time tracking cell; if corrupted/invalid, throws `failed-precondition` (does not reset data to empty).
- **Idempotency**: if timer is already running, returns the existing open session `{ success: true, sessionId, startedAt }` without performing duplicate writes.
- Maximum session limit (500) enforced with `resource-exhausted`.
- Creates new session `{ id, startedAt: nowMs, userId: auth.uid, duration: 0, note }`.
- Sets `running: true`, `startDate: nowMs`.
- Validates updated value via `timeTrackingValueSchema.parse(updated)`.
- Atomically updates item `values.<columnId>` using `new FieldPath('values', columnId)`, `updatedAt: serverTimestamp()`, `updatedBy: auth.uid`.

### 3.3 `stopTimeTracking` Invariants

- Item must exist and have `state: 'active'`.
- Column must exist in `board.columns` and have `type: 'time_tracking'`.
- Validates stored time tracking cell; if corrupted/invalid, throws `failed-precondition`.
- **Idempotency**: if timer is already stopped and caller provided a matching `sessionId` from a completed session, returns no-op success.
- If not running and no `sessionId` is provided, throws `failed-precondition`.
- Finds open session (`endedAt === undefined`), clamps `endedAt = Math.max(nowMs, startedAt)` on clock skew, calculates session duration `floor((safeEndedAt - startedAt) / 1000)`.
- Updates total duration `duration += sessionDuration`, sets `running: false`, omits `startDate` (no `undefined` own property).
- Validates updated value via `timeTrackingValueSchema.parse(updated)`.
- Atomically updates item `values.<columnId>` using `new FieldPath('values', columnId)`, `updatedAt: serverTimestamp()`, `updatedBy: auth.uid`.

### 3.4 `clickButton` Invariants

- Item must exist and have `state: 'active'`.
- Column must exist in `board.columns` and have `type: 'button'`.
- Parses column settings with `buttonSettingsSchema` to ensure defaults (`label: 'Click'`, `color: '#579bfc'`), never writing undefined.
- Appends new document to `boards/{boardId}/activity`:
  - `kind: 'button_clicked'`
  - `itemId`, `columnId`, `userId: auth.uid`
  - `createdAt: serverTimestamp()`
  - `data: { itemName, columnLabel, columnColor }`
- Returns activity document ID and timestamp.

### 3.5 FW2 Rule Backing

- Server-managed columns (`time_tracking`, `files`, `button`) are marked `serverManaged: true` in their column modules.
- Firestore security rules deny direct client writes to `values.<colId>` via `boards.serverManagedColumnIds`.
- All updates must execute through these Cloud Function callables using the Admin SDK.

---

## 4. Testing & Verification

1. Unit tests in `functions/src/lib/column-actions.test.ts` using an in-memory/mock transactional store.
2. Positive and negative tests:
   - Success start and stop timer.
   - Refusal to start if already running.
   - Refusal to stop if not running.
   - Refusal if column is wrong type or missing.
   - Refusal if item is deleted or archived.
   - Refusal if caller is a viewer or outsider.
   - Button click event appending to activity log.
3. Full verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:rules`, `pnpm build`.
