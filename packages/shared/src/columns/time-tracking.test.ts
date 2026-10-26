import { describe, expect, it } from 'vitest';
import {
  addManualSession,
  columnRegistry,
  computeTotalSeconds,
  deleteSession,
  formatDuration,
  getPerPersonTotals,
  startTimer,
  stopTimer,
  timeTrackingColumn,
  timeTrackingSettingsSchema,
  timeTrackingValueSchema,
  validateManualSession,
  type TimeTrackingValue,
} from './index';

describe('P2 Time Tracking Column', () => {
  it('validates time tracking value schema and superRefine invariants', () => {
    // Valid empty stopped timer
    const validStopped = timeTrackingValueSchema.safeParse({
      duration: 0,
      running: false,
      history: [],
    });
    expect(validStopped.success).toBe(true);

    // Valid stopped timer with closed sessions matching duration
    const validClosed = timeTrackingValueSchema.safeParse({
      duration: 10,
      running: false,
      history: [
        {
          id: 's1',
          startedAt: 1000,
          endedAt: 11000,
          duration: 10,
          userId: 'u1',
        },
      ],
    });
    expect(validClosed.success).toBe(true);

    // Valid running timer with exactly one open session matching startDate
    const validRunning = timeTrackingValueSchema.safeParse({
      duration: 10,
      running: true,
      startDate: 20000,
      history: [
        {
          id: 's1',
          startedAt: 1000,
          endedAt: 11000,
          duration: 10,
          userId: 'u1',
        },
        {
          id: 's2',
          startedAt: 20000,
          duration: 0,
          userId: 'u1',
        },
      ],
    });
    expect(validRunning.success).toBe(true);

    // Invariant: Running timer must have startDate
    const runningMissingStart = timeTrackingValueSchema.safeParse({
      duration: 0,
      running: true,
      history: [{ id: 's1', startedAt: 1000, duration: 0, userId: 'u1' }],
    });
    expect(runningMissingStart.success).toBe(false);

    // Invariant: Running timer open session startedAt must match startDate
    const runningMismatchedStart = timeTrackingValueSchema.safeParse({
      duration: 0,
      running: true,
      startDate: 2000,
      history: [{ id: 's1', startedAt: 1000, duration: 0, userId: 'u1' }],
    });
    expect(runningMismatchedStart.success).toBe(false);

    // Invariant: Stopped timer cannot have open sessions
    const stoppedWithOpen = timeTrackingValueSchema.safeParse({
      duration: 0,
      running: false,
      history: [{ id: 's1', startedAt: 1000, duration: 0, userId: 'u1' }],
    });
    expect(stoppedWithOpen.success).toBe(false);

    // Invariant: Duration must equal sum of closed sessions
    const mismatchedDuration = timeTrackingValueSchema.safeParse({
      duration: 999, // Should be 10
      running: false,
      history: [
        {
          id: 's1',
          startedAt: 1000,
          endedAt: 11000,
          duration: 10,
          userId: 'u1',
        },
      ],
    });
    expect(mismatchedDuration.success).toBe(false);

    // Invariant: Session duration must equal floor((endedAt - startedAt) / 1000)
    const mismatchedSessionDuration = timeTrackingValueSchema.safeParse({
      duration: 5,
      running: false,
      history: [
        {
          id: 's1',
          startedAt: 1000,
          endedAt: 11000, // 10s elapsed
          duration: 5, // Invalid
          userId: 'u1',
        },
      ],
    });
    expect(mismatchedSessionDuration.success).toBe(false);

    // Invariant: endedAt must be >= startedAt
    const invalidSessionTimes = timeTrackingValueSchema.safeParse({
      duration: 0,
      running: false,
      history: [
        {
          id: 's1',
          startedAt: 5000,
          endedAt: 2000,
          duration: 0,
          userId: 'u1',
        },
      ],
    });
    expect(invalidSessionTimes.success).toBe(false);

    // Invariant: Session IDs must be unique
    const duplicateIds = timeTrackingValueSchema.safeParse({
      duration: 20,
      running: false,
      history: [
        { id: 'dup', startedAt: 1000, endedAt: 11000, duration: 10, userId: 'u1' },
        { id: 'dup', startedAt: 12000, endedAt: 22000, duration: 10, userId: 'u1' },
      ],
    });
    expect(duplicateIds.success).toBe(false);
  });

  it('validates settings schema and defaults', () => {
    const defaults = timeTrackingColumn.defaultSettings();
    expect(defaults).toEqual({ trackHistory: true, requireNote: false });
    expect(timeTrackingSettingsSchema.safeParse(defaults).success).toBe(true);
  });

  it('computes live elapsed seconds for running timer display', () => {
    expect(computeTotalSeconds({ duration: 150, running: false })).toBe(150);

    const now = 1700000020000;
    const runningVal: TimeTrackingValue = {
      duration: 100,
      running: true,
      startDate: 1700000000000,
      history: [
        {
          id: 's_closed',
          startedAt: 1699990000000,
          endedAt: 1699990100000,
          duration: 100,
          userId: 'u1',
        },
        {
          id: 's_open',
          startedAt: 1700000000000,
          duration: 0,
          userId: 'u1',
        },
      ],
    };
    expect(computeTotalSeconds(runningVal, now)).toBe(120);
  });

  it('formats duration in human and digital modes', () => {
    expect(formatDuration(0, 'human')).toBe('0s');
    expect(formatDuration(45, 'human')).toBe('45s');
    expect(formatDuration(125, 'human')).toBe('2m 5s');
    expect(formatDuration(3665, 'human')).toBe('1h 1m 5s');

    expect(formatDuration(0, 'digital')).toBe('00:00:00');
    expect(formatDuration(45, 'digital')).toBe('00:00:45');
    expect(formatDuration(3665, 'digital')).toBe('01:01:05');
  });

  it('starts and stops timer with caller-supplied session ID and finds open session', () => {
    const initial: TimeTrackingValue = { duration: 0, running: false, history: [] };

    const t0 = 1700000000000;
    const started = startTimer(initial, 'user_1', 'sess_1', t0);
    expect(started.running).toBe(true);
    expect(started.startDate).toBe(t0);
    expect(started.history).toHaveLength(1);
    expect(started.history?.[0]?.id).toBe('sess_1');
    expect(started.history?.[0]?.userId).toBe('user_1');

    // Duplicate session ID is rejected
    expect(() => startTimer(initial, 'user_1', 'sess_1', t0)).not.toThrow();
    expect(() => {
      const firstSession = started.history?.[0];
      if (!firstSession) throw new Error('Expected first session');
      const valWithSess1: TimeTrackingValue = {
        ...initial,
        history: [firstSession],
      };
      startTimer(valWithSess1, 'user_1', 'sess_1', t0);
    }).toThrow(/already exists/);

    // Stop timer 45 seconds later
    const t1 = t0 + 45000;
    const stopped = stopTimer(started, t1);
    expect(stopped.running).toBe(false);
    expect(stopped.startDate).toBeUndefined();
    // Ensures startDate is omitted, not present as an undefined own key (Firestore safety)
    expect(Object.prototype.hasOwnProperty.call(stopped, 'startDate')).toBe(false);
    expect(stopped.duration).toBe(45);
    expect(stopped.history?.[0]?.endedAt).toBe(t1);
    expect(stopped.history?.[0]?.duration).toBe(45);

    // Result conforms to schema invariants
    expect(timeTrackingValueSchema.safeParse(stopped).success).toBe(true);
  });

  it('clamps endedAt to startedAt when stopTimer is called with nowMs < startedAt', () => {
    const initial: TimeTrackingValue = { duration: 0, running: false, history: [] };
    const t0 = 1700000010000;
    const started = startTimer(initial, 'user_1', 'sess_clamp', t0);

    // Clock skew / past timestamp: nowMs < startedAt
    const pastTime = t0 - 5000;
    const stopped = stopTimer(started, pastTime);

    expect(stopped.running).toBe(false);
    expect(stopped.duration).toBe(0);
    expect(stopped.history?.[0]?.startedAt).toBe(t0);
    // Clamped so endedAt >= startedAt
    expect(stopped.history?.[0]?.endedAt).toBe(t0);
    expect(stopped.history?.[0]?.duration).toBe(0);
    expect(timeTrackingValueSchema.safeParse(stopped).success).toBe(true);
  });

  it('records sessions during startTimer and stopTimer even when trackHistory is false', () => {
    const initial: TimeTrackingValue = { duration: 0, running: false, history: [] };
    const t0 = 1700000000000;
    // trackHistory: false disables manual entry in UI, but start/stop still records sessions
    const started = startTimer(initial, 'u1', 's_auto', t0);
    const stopped = stopTimer(started, t0 + 30000);

    expect(stopped.history).toHaveLength(1);
    expect(stopped.duration).toBe(30);
    expect(stopped.history?.[0]?.id).toBe('s_auto');
    expect(timeTrackingValueSchema.parse(stopped)).toBeDefined();
  });

  it('enforces 500-session cap on startTimer and addManualSession', () => {
    const sessions = Array.from({ length: 500 }, (_, i) => ({
      id: `s_${i}`,
      startedAt: 1000 + i * 2000,
      endedAt: 2000 + i * 2000,
      duration: 1,
      userId: 'u1',
    }));
    const fullValue: TimeTrackingValue = {
      duration: 500,
      running: false,
      history: sessions,
    };

    expect(() => startTimer(fullValue, 'u1', 's_501', 999999999)).toThrow(/500.*reached/);
    expect(() =>
      addManualSession(fullValue, { startedAt: 100, endedAt: 200, userId: 'u1' }, 's_501'),
    ).toThrow(/500.*reached/);
  });

  it('blocks addManualSession while timer is running', () => {
    const running: TimeTrackingValue = {
      duration: 0,
      running: true,
      startDate: 1000,
      history: [{ id: 'open_1', startedAt: 1000, duration: 0, userId: 'u1' }],
    };

    expect(() =>
      addManualSession(running, { startedAt: 100, endedAt: 200, userId: 'u1' }, 'm1'),
    ).toThrow(/Cannot add manual session while timer is running/);
  });

  it('validates manual sessions with standalone validateManualSession', () => {
    const now = 2000000;
    // Valid session
    const validRes = validateManualSession(
      { startedAt: 1000000, endedAt: 1500000, userId: 'u1', note: 'Done' },
      { trackHistory: true, requireNote: true },
      now,
    );
    expect(validRes.valid).toBe(true);

    // Rejects when trackHistory is disabled
    const disabledHistory = validateManualSession(
      { startedAt: 1000000, endedAt: 1500000, userId: 'u1' },
      { trackHistory: false, requireNote: false },
      now,
    );
    expect(disabledHistory.valid).toBe(false);
    expect(disabledHistory).toHaveProperty('error', expect.stringContaining('disabled'));

    // Rejects when note is required but missing
    const missingNote = validateManualSession(
      { startedAt: 1000000, endedAt: 1500000, userId: 'u1' },
      { trackHistory: true, requireNote: true },
      now,
    );
    expect(missingNote.valid).toBe(false);
    expect(missingNote).toHaveProperty('error', expect.stringContaining('note is required'));

    // Rejects future dates
    const futureSession = validateManualSession(
      { startedAt: now + 5000, endedAt: now + 10000, userId: 'u1' },
      { trackHistory: true, requireNote: false },
      now,
    );
    expect(futureSession.valid).toBe(false);
    expect(futureSession).toHaveProperty('error', expect.stringContaining('future'));

    // Rejects non-integer or non-positive timestamps
    expect(
      validateManualSession(
        { startedAt: 1000.5, endedAt: 2000, userId: 'u1' },
        { trackHistory: true, requireNote: false },
        now,
      ).valid,
    ).toBe(false);
    expect(
      validateManualSession(
        { startedAt: 1000, endedAt: 2000.75, userId: 'u1' },
        { trackHistory: true, requireNote: false },
        now,
      ).valid,
    ).toBe(false);
    expect(
      validateManualSession(
        { startedAt: 0, endedAt: 2000, userId: 'u1' },
        { trackHistory: true, requireNote: false },
        now,
      ).valid,
    ).toBe(false);
    expect(
      validateManualSession(
        { startedAt: -500, endedAt: 2000, userId: 'u1' },
        { trackHistory: true, requireNote: false },
        now,
      ).valid,
    ).toBe(false);

    // Rejects endedAt < startedAt
    const invalidRange = validateManualSession(
      { startedAt: 1500000, endedAt: 1000000, userId: 'u1' },
      { trackHistory: true, requireNote: false },
      now,
    );
    expect(invalidRange.valid).toBe(false);
  });

  it('adds manual sessions, updates duration, and calculates per-person totals', () => {
    let val: TimeTrackingValue = { duration: 0, running: false, history: [] };

    const tStart = 1700000000000;
    const tEnd = tStart + 3600000; // 1 hour = 3600s
    val = addManualSession(
      val,
      {
        startedAt: tStart,
        endedAt: tEnd,
        userId: 'user_alex',
        note: 'Sprint planning',
      },
      'manual_1',
      { trackHistory: true, requireNote: true },
      tEnd + 1000,
    );

    expect(val.duration).toBe(3600);
    expect(val.history).toHaveLength(1);
    expect(val.history?.[0]?.note).toBe('Sprint planning');

    // Add second session: 30 minutes = 1800s
    val = addManualSession(
      val,
      {
        startedAt: tEnd,
        endedAt: tEnd + 1800000,
        userId: 'user_sam',
      },
      'manual_2',
      { trackHistory: true, requireNote: false },
      tEnd + 2000000,
    );
    expect(val.duration).toBe(5400);

    // Check per-person totals
    const totals = getPerPersonTotals(val);
    expect(totals['user_alex']).toBe(3600);
    expect(totals['user_sam']).toBe(1800);

    // Delete first session: subtracts only deleted session's duration
    val = deleteSession(val, 'manual_1');
    expect(val.duration).toBe(1800);
    expect(val.history).toHaveLength(1);
    expect(val.history?.[0]?.id).toBe('manual_2');
    expect(timeTrackingValueSchema.safeParse(val).success).toBe(true);
  });

  it('refuses to delete an active running session', () => {
    const running: TimeTrackingValue = {
      duration: 10,
      running: true,
      startDate: 20000,
      history: [
        { id: 's1', startedAt: 1000, endedAt: 11000, duration: 10, userId: 'u1' },
        { id: 'active_1', startedAt: 20000, duration: 0, userId: 'u1' },
      ],
    };

    expect(() => deleteSession(running, 'active_1')).toThrow(
      /Cannot delete an active running session/,
    );
  });

  it('toText, compare, and aggregate use stored duration without Date.now()', () => {
    const val1: TimeTrackingValue = { duration: 100, running: false, history: [] };
    const val2: TimeTrackingValue = { duration: 250, running: false, history: [] };
    const settings = timeTrackingColumn.defaultSettings();

    // toText formats stored duration deterministically
    expect(timeTrackingColumn.toText(val1, settings)).toBe('1m 40s');
    expect(timeTrackingColumn.toText(val2, settings)).toBe('4m 10s');

    // compare sorts deterministically by stored duration
    expect(timeTrackingColumn.compare(val1, val2, settings)).toBe(-150);
    expect(timeTrackingColumn.compare(val2, val1, settings)).toBe(150);

    // aggregate returns sum and count
    const agg = timeTrackingColumn.aggregate?.([val1, null, val2, undefined], settings);
    expect(agg).toEqual({
      kind: 'sum',
      sum: 350,
      count: 2,
    });

    // aggregate returns null for all-empty
    const emptyAgg = timeTrackingColumn.aggregate?.([null, undefined], settings);
    expect(emptyAgg).toBeNull();
  });

  it('integrates into columnRegistry and is marked serverManaged', () => {
    expect(columnRegistry.has('time_tracking')).toBe(true);
    const col = columnRegistry.get('time_tracking');
    expect(col.label).toBe('Time Tracking');
    expect(col.serverManaged).toBe(true);
  });
});
