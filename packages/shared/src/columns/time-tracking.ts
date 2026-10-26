import { z } from 'zod';
import { defineColumnType } from './registry';

export const timeTrackingSettingsSchema = z
  .object({
    /**
     * Whether manual session entry is enabled and session history is displayed in UI.
     * When false, start/stop timers still record sessions internally for schema invariants,
     * but manual entry is blocked and history is hidden in the UI.
     */
    trackHistory: z.boolean().default(true),
    /** Whether a note or description is required for manual sessions. */
    requireNote: z.boolean().default(false),
  })
  .strict();
export type TimeTrackingSettings = z.infer<typeof timeTrackingSettingsSchema>;

export const timeTrackingSessionSchema = z
  .object({
    id: z.string().min(1),
    startedAt: z.number().int().positive(),
    endedAt: z.number().int().positive().optional(),
    duration: z.number().int().min(0),
    userId: z.string().min(1),
    note: z.string().max(500).optional(),
  })
  .strict();
export type TimeTrackingSession = z.infer<typeof timeTrackingSessionSchema>;

export const timeTrackingValueSchema = z
  .object({
    /** Total accumulated seconds from completed sessions. */
    duration: z.number().int().min(0),
    /** Whether the timer is currently actively running. */
    running: z.boolean(),
    /** Epoch timestamp in ms when the current running timer was started. */
    startDate: z.number().int().positive().optional(),
    /** Log of all time tracking sessions. */
    history: z.array(timeTrackingSessionSchema).max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const history = val.history ?? [];

    // Unique session ids
    const ids = new Set<string>();
    for (let i = 0; i < history.length; i++) {
      const s = history[i];
      if (!s) continue;
      if (ids.has(s.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate session id "${s.id}"`,
          path: ['history', i, 'id'],
        });
      }
      ids.add(s.id);
    }

    // Open vs closed sessions
    const openSessions: { session: TimeTrackingSession; index: number }[] = [];
    let sumClosedDuration = 0;

    for (let i = 0; i < history.length; i++) {
      const s = history[i];
      if (!s) continue;
      if (s.endedAt === undefined) {
        openSessions.push({ session: s, index: i });
        if (s.duration !== 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Open session must have duration 0',
            path: ['history', i, 'duration'],
          });
        }
      } else {
        if (s.endedAt < s.startedAt) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'endedAt must be greater than or equal to startedAt',
            path: ['history', i, 'endedAt'],
          });
        }
        const expectedDuration = Math.floor((s.endedAt - s.startedAt) / 1000);
        if (s.duration !== expectedDuration) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Session duration (${s.duration}) does not match elapsed seconds (${expectedDuration})`,
            path: ['history', i, 'duration'],
          });
        }
        sumClosedDuration += s.duration;
      }
    }

    if (val.running) {
      if (openSessions.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Running timer must have exactly one open session, found ${openSessions.length}`,
          path: ['history'],
        });
      }
      if (val.startDate === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'startDate is required when timer is running',
          path: ['startDate'],
        });
      } else {
        const firstOpen = openSessions[0];
        if (firstOpen && firstOpen.session.startedAt !== val.startDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Open session startedAt (${firstOpen.session.startedAt}) must equal startDate (${val.startDate})`,
            path: ['startDate'],
          });
        }
      }
    } else {
      if (openSessions.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Stopped timer cannot have open sessions, found ${openSessions.length}`,
          path: ['history'],
        });
      }
      if (val.startDate !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'startDate must be undefined when timer is not running',
          path: ['startDate'],
        });
      }
    }

    if (val.duration !== sumClosedDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value duration (${val.duration}) must equal the sum of closed sessions (${sumClosedDuration})`,
        path: ['duration'],
      });
    }
  });
export type TimeTrackingValue = z.infer<typeof timeTrackingValueSchema>;

/**
 * Computes the real-time total duration in seconds, adding active timer seconds if running.
 * Used by UI components for live timer ticking.
 */
export function computeTotalSeconds(value: TimeTrackingValue, nowMs = Date.now()): number {
  if (!value.running || value.startDate === undefined) {
    return value.duration;
  }
  const elapsed = Math.max(0, Math.floor((nowMs - value.startDate) / 1000));
  return value.duration + elapsed;
}

/**
 * Formats a duration in seconds into a friendly string.
 * e.g. mode 'human': "1h 23m 45s", "45s", "0s".
 * e.g. mode 'digital': "01:23:45", "00:00:45".
 */
export function formatDuration(seconds: number, mode: 'human' | 'digital' = 'human'): string {
  const safeSec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safeSec / 3600);
  const m = Math.floor((safeSec % 3600) / 60);
  const s = safeSec % 60;

  if (mode === 'digital') {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * Validates a manual session against column settings and timing rules.
 */
export function validateManualSession(
  session: { startedAt: number; endedAt: number; userId: string; note?: string },
  settings?: TimeTrackingSettings,
  nowMs = Date.now(),
): { valid: true } | { valid: false; error: string } {
  if (
    !Number.isInteger(session.startedAt) ||
    session.startedAt <= 0 ||
    !Number.isInteger(session.endedAt) ||
    session.endedAt <= 0
  ) {
    return { valid: false, error: 'startedAt and endedAt must be positive integers' };
  }
  if (settings && !settings.trackHistory) {
    return { valid: false, error: 'Manual session entry is disabled when trackHistory is false' };
  }
  if (settings?.requireNote && (!session.note || session.note.trim() === '')) {
    return { valid: false, error: 'A note is required for manual sessions' };
  }
  if (session.endedAt < session.startedAt) {
    return { valid: false, error: 'endedAt must be greater than or equal to startedAt' };
  }
  if (session.startedAt > nowMs || session.endedAt > nowMs) {
    return { valid: false, error: 'Session timestamps cannot be in the future' };
  }
  if (!session.userId || session.userId.trim() === '') {
    return { valid: false, error: 'userId is required' };
  }
  return { valid: true };
}

/**
 * Starts an active tracking timer.
 * Requires a caller-supplied unique sessionId. Refuses if 500 session limit is reached.
 */
export function startTimer(
  value: TimeTrackingValue,
  userId: string,
  sessionId: string,
  nowMs = Date.now(),
): TimeTrackingValue {
  if (value.running) return value;

  const history = value.history ? [...value.history] : [];
  if (history.length >= 500) {
    throw new Error('Maximum session history limit (500) reached');
  }
  if (history.some((s) => s.id === sessionId)) {
    throw new Error(`Session ID "${sessionId}" already exists`);
  }

  const newSession: TimeTrackingSession = {
    id: sessionId,
    startedAt: nowMs,
    duration: 0,
    userId,
  };

  return {
    ...value,
    running: true,
    startDate: nowMs,
    history: [...history, newSession],
  };
}

/**
 * Stops an active tracking timer and updates total duration.
 * Locates the open session by `endedAt === undefined`.
 * Clamps endedAt to at least startedAt if nowMs is in the past.
 * Omits startDate from the returned value so no undefined own key is set.
 */
export function stopTimer(value: TimeTrackingValue, nowMs = Date.now()): TimeTrackingValue {
  if (!value.running || value.startDate === undefined) return value;

  const history = value.history ? [...value.history] : [];
  const openIndex = history.findIndex((s) => s.endedAt === undefined);
  if (openIndex === -1) {
    const { startDate: _, ...stopped } = value;
    return {
      ...stopped,
      running: false,
    };
  }

  const openSession = history[openIndex];
  if (!openSession) {
    const { startDate: _, ...stopped } = value;
    return {
      ...stopped,
      running: false,
    };
  }
  const safeEndedAt = Math.max(nowMs, openSession.startedAt);
  const sessionSeconds = Math.max(0, Math.floor((safeEndedAt - openSession.startedAt) / 1000));
  const closedSession: TimeTrackingSession = {
    ...openSession,
    endedAt: safeEndedAt,
    duration: sessionSeconds,
  };

  history[openIndex] = closedSession;
  const newDuration = value.duration + sessionSeconds;

  const { startDate: _, ...stopped } = value;
  return {
    ...stopped,
    duration: newDuration,
    running: false,
    history,
  };
}

/**
 * Adds a manually entered session to the history.
 * Blocked while timer is running. Refuses if 500 session cap is reached or if settings check fails.
 */
export function addManualSession(
  value: TimeTrackingValue,
  session: { startedAt: number; endedAt: number; userId: string; note?: string },
  sessionId: string,
  settings?: TimeTrackingSettings,
  nowMs = Date.now(),
): TimeTrackingValue {
  if (value.running) {
    throw new Error('Cannot add manual session while timer is running');
  }

  const validation = validateManualSession(session, settings, nowMs);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const history = value.history ? [...value.history] : [];
  if (history.length >= 500) {
    throw new Error('Maximum session history limit (500) reached');
  }
  if (history.some((s) => s.id === sessionId)) {
    throw new Error(`Session ID "${sessionId}" already exists`);
  }

  const sessionSeconds = Math.max(0, Math.floor((session.endedAt - session.startedAt) / 1000));
  const newSession: TimeTrackingSession = {
    id: sessionId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    duration: sessionSeconds,
    userId: session.userId,
    ...(session.note ? { note: session.note } : {}),
  };

  return {
    ...value,
    duration: value.duration + sessionSeconds,
    history: [...history, newSession],
  };
}

/**
 * Deletes a session from history and subtracts only the deleted session's duration.
 * Refuses to delete the open active session.
 */
export function deleteSession(value: TimeTrackingValue, sessionId: string): TimeTrackingValue {
  if (!value.history || value.history.length === 0) return value;
  const session = value.history.find((s) => s.id === sessionId);
  if (!session) return value;

  if (session.endedAt === undefined) {
    throw new Error('Cannot delete an active running session');
  }

  const filtered = value.history.filter((s) => s.id !== sessionId);
  return {
    ...value,
    duration: Math.max(0, value.duration - session.duration),
    history: filtered,
  };
}

/**
 * Calculates aggregated tracking seconds grouped by user.
 */
export function getPerPersonTotals(value: TimeTrackingValue): Record<string, number> {
  const totals: Record<string, number> = {};
  if (!value.history) return totals;

  for (const session of value.history) {
    const current = totals[session.userId] ?? 0;
    totals[session.userId] = current + session.duration;
  }
  return totals;
}

export const timeTrackingColumn = defineColumnType<TimeTrackingSettings, TimeTrackingValue>({
  type: 'time_tracking',
  label: 'Time Tracking',
  serverManaged: true,
  settingsSchema: timeTrackingSettingsSchema,
  valueSchema: timeTrackingValueSchema,
  summaries: [
    'count',
    'count_filled',
    'count_empty',
    'percent_filled',
    'sum',
    'average',
    'min',
    'max',
  ],
  defaultSettings: () => ({ trackHistory: true, requireNote: false }),
  toText: (value) => formatDuration(value.duration),
  compare: (a, b) => a.duration - b.duration,
  aggregate: (values) => {
    let sum = 0;
    let count = 0;
    for (const v of values) {
      if (!v) continue;
      sum += v.duration;
      count += 1;
    }
    if (count === 0) return null;
    return { kind: 'sum', sum, count };
  },
});
