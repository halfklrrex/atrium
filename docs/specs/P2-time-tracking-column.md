# P2 Spec: Time Tracking Column

**Epic:** Time tracking column  
**Roadmap Item:** `3306234339` (Phase P2: Full Column Library)  
**Agent:** Antigravity (Codename: Ava)  
**Branch:** `ag/column-time-tracking`

---

## 1. Overview & Business Context

The Time Tracking column enables users to record working hours, track active task timers, enter retroactive manual sessions, inspect session histories, and aggregate hours across users and groups. It aligns with monday.com's time tracking column specification:

- **Active Timer**: Displays a ticking stop/start button in the cell with real-time duration updates.
- **Session History Log**: Tracks individual sessions with timestamps, durations, users, and optional notes.
- **Manual Adjustments**: Allows adding or deleting past sessions with automatic duration recalculations.
- **Group-Level Aggregation**: Aggregates total recorded time across all items in a group footer.
- **Server-Side Security**: Start/stop actions will run through a dedicated backend callable (`boards/{id}/items/{itemId}/timeTracking/start` / `stop`) using server-side timestamps and `request.auth.uid` to prevent client clock manipulation (Roadmap task `3307097019`). Shared helpers provide pure, deterministic transforms on the stored value.

---

## 2. Canonical Internal Shape & monday.com Mapping

### 2.1 Canonical Internal Shape

The canonical stored cell shape in Atrium Firestore is:

```ts
{
  duration: number; // accumulated total duration in seconds from closed sessions
  running: boolean; // whether the timer is currently actively running
  startDate?: number; // epoch ms when the current running timer was started
  history?: Array<{
    id: string; // unique session ID
    startedAt: number; // epoch ms of session start
    endedAt?: number; // epoch ms of session end (undefined for open session)
    duration: number; // closed session duration in seconds (0 for open session)
    userId: string; // user who recorded or owns the session
    note?: string; // optional session description
  }>;
}
```

### 2.2 Mapping from monday.com API Format

monday.com stores time tracking values in its own JSON format across GraphQL API v2:

| Concept              | monday.com API v2                           | Atrium Canonical             | Converter Note                                    |
| :------------------- | :------------------------------------------ | :--------------------------- | :------------------------------------------------ |
| **Duration**         | `duration` (integer seconds)                | `duration` (integer seconds) | 1:1 mapping                                       |
| **Running state**    | `running` (boolean)                         | `running` (boolean)          | 1:1 mapping                                       |
| **Start time**       | `started_at` (ISO 8601 string or epoch sec) | `startDate` (epoch ms)       | Convert to `Date.parse(started_at)`               |
| **Session history**  | `additional_value.sessions`                 | `history`                    | List of sessions                                  |
| **Session ID**       | `id` (integer or string)                    | `id` (string)                | `String(s.id)`                                    |
| **Session Start**    | `started_at` (ISO string)                   | `startedAt` (epoch ms)       | `Date.parse(s.started_at)`                        |
| **Session End**      | `ended_at` (ISO string)                     | `endedAt` (epoch ms)         | `s.ended_at ? Date.parse(s.ended_at) : undefined` |
| **Session Duration** | `duration` (seconds)                        | `duration` (seconds)         | 1:1 mapping                                       |
| **User ID**          | `started_user_id`                           | `userId`                     | Maps to Atrium Firebase `uid`                     |
| **Note**             | `description` or `note`                     | `note`                       | Optional string                                   |

---

## 3. Data Models & Schemas

### 3.1 Settings Schema (`timeTrackingSettingsSchema`)

```ts
export const timeTrackingSettingsSchema = z
  .object({
    /**
     * Whether manual session entry is enabled and session history is displayed in UI.
     * When false, start/stop timers still record sessions internally for schema invariants,
     * but manual entry is blocked and history is hidden in the UI.
     */
    trackHistory: z.boolean().default(true),
    requireNote: z.boolean().default(false),
  })
  .strict();
```

> **Lead Decision on `trackHistory: false`:**
> Setting `trackHistory: false` disables manual session entry and hides the session history log in the UI. Active start/stop timers still append and update session records under the hood because the schema invariants (`duration === sum(closed sessions)`, open session matching `startDate`) strictly require session records.

### 3.2 Value Schema with `superRefine` Invariants

```ts
export const timeTrackingValueSchema = z
  .object({
    duration: z.number().int().min(0),
    running: z.boolean(),
    startDate: z.number().int().positive().optional(),
    history: z.array(timeTrackingSessionSchema).max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Invariants enforced:
    // 1. Session IDs must be unique across history.
    // 2. Exactly one open session (endedAt === undefined) iff running is true.
    // 3. Open session startedAt === startDate.
    // 4. duration === sum of closed sessions.
    // 5. Each closed session duration === floor((endedAt - startedAt) / 1000).
    // 6. endedAt >= startedAt for all closed sessions.
  });
```

---

## 4. Helpers & Lifecycle Methods

- **`validateManualSession(session, settings, nowMs)`**: Standalone validation checking that `startedAt` and `endedAt` are positive integers, `trackHistory` is enabled (manual sessions disabled otherwise), `requireNote` is satisfied, `endedAt >= startedAt`, and timestamps are not in the future.
- **`startTimer(value, userId, sessionId, nowMs)`**: Starts active timer, requiring caller-supplied unique `sessionId`. Refuses if 500-session limit is reached.
- **`stopTimer(value, nowMs)`**: Finds open session by `endedAt === undefined`, clamps `endedAt = Math.max(nowMs, startedAt)` to prevent inverted spans on clock skew, accumulates elapsed seconds into `duration`, and omits `startDate` without leaving an `undefined` key.
- **`addManualSession(value, session, sessionId, settings, nowMs)`**: Validates manual session rules, blocks if timer is currently running, checks 500 cap, and increments duration.
- **`deleteSession(value, sessionId)`**: Subtracts only the target session's duration, refusing to delete active running session.
- **`computeTotalSeconds(value, nowMs)`**: Real-time display calculator adding active session ticks.
- **`toText`, `compare`, `aggregate`**: Deterministic functions based on stored `duration` without calling `Date.now()`. `aggregate` returns `null` for empty sets.
- **`serverManaged: true` (FW2)**: The column type definition is marked with `serverManaged: true` so Firestore rules prevent direct client writes (`boards/{id}.serverManagedColumnIds`), requiring timer updates to go through backend callables (`startTimeTracking`, `stopTimeTracking`).
