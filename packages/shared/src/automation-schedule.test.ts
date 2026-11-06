import { describe, expect, it } from 'vitest';
import {
  computeNextRunAt,
  dateArrivesTargetDate,
  dateKeysOf,
  dateRunId,
  localDateInZone,
  recurringRunId,
} from './automation-schedule';

const utc = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const daily = (at: string) => ({ every: 'day' as const, at });

describe('computeNextRunAt: daily', () => {
  it('is strictly after afterMs', () => {
    const at = utc('2026-11-06T08:00:00Z'); // 09:00 in Madrid (CET)
    expect(iso(computeNextRunAt(daily('09:00'), 'Europe/Madrid', at - 1))).toBe(
      '2026-11-06T08:00:00.000Z',
    );
    expect(iso(computeNextRunAt(daily('09:00'), 'Europe/Madrid', at))).toBe(
      '2026-11-07T08:00:00.000Z',
    );
  });

  it('uses the zone without DST as is (Asia/Tokyo)', () => {
    expect(iso(computeNextRunAt(daily('09:00'), 'Asia/Tokyo', utc('2026-03-29T00:00:00Z')))).toBe(
      '2026-03-30T00:00:00.000Z',
    );
  });

  it('Madrid spring forward: a missing local time runs at the first valid instant', () => {
    const after = utc('2026-03-28T12:00:00Z');
    // 02:30 on 2026-03-29 does not exist; the clock jumps from 02:00 to 03:00 (01:00Z).
    expect(iso(computeNextRunAt(daily('02:30'), 'Europe/Madrid', after))).toBe(
      '2026-03-29T01:00:00.000Z',
    );
    // The run after that is the next day at 02:30 CEST = 00:30Z.
    expect(
      iso(computeNextRunAt(daily('02:30'), 'Europe/Madrid', utc('2026-03-29T01:00:00Z'))),
    ).toBe('2026-03-30T00:30:00.000Z');
    // A time on either side keeps its wall clock.
    expect(iso(computeNextRunAt(daily('09:00'), 'Europe/Madrid', after))).toBe(
      '2026-03-29T07:00:00.000Z',
    );
    expect(
      iso(computeNextRunAt(daily('09:00'), 'Europe/Madrid', utc('2026-03-27T12:00:00Z'))),
    ).toBe('2026-03-28T08:00:00.000Z');
  });

  it('Madrid fall back: an ambiguous local time runs once, on the first occurrence', () => {
    const after = utc('2026-10-24T12:00:00Z');
    const first = computeNextRunAt(daily('02:30'), 'Europe/Madrid', after);
    expect(iso(first)).toBe('2026-10-25T00:30:00.000Z'); // 02:30 CEST
    // Not again at 02:30 CET (01:30Z): the next run is the following day.
    expect(iso(computeNextRunAt(daily('02:30'), 'Europe/Madrid', first))).toBe(
      '2026-10-26T01:30:00.000Z',
    );
    expect(iso(computeNextRunAt(daily('09:00'), 'Europe/Madrid', first))).toBe(
      '2026-10-25T08:00:00.000Z',
    );
  });

  it('New York spring forward (2026-03-08) and fall back (2026-11-01)', () => {
    expect(
      iso(computeNextRunAt(daily('02:30'), 'America/New_York', utc('2026-03-07T12:00:00Z'))),
    ).toBe('2026-03-08T07:00:00.000Z');
    expect(
      iso(computeNextRunAt(daily('09:00'), 'America/New_York', utc('2026-03-07T20:00:00Z'))),
    ).toBe('2026-03-08T13:00:00.000Z'); // EDT
    const first = computeNextRunAt(daily('01:30'), 'America/New_York', utc('2026-10-31T12:00:00Z'));
    expect(iso(first)).toBe('2026-11-01T05:30:00.000Z'); // EDT
    expect(iso(computeNextRunAt(daily('01:30'), 'America/New_York', first))).toBe(
      '2026-11-02T06:30:00.000Z', // EST
    );
  });
});

describe('computeNextRunAt: weekly and monthly', () => {
  it('finds the weekday in the zone (0 = Sunday)', () => {
    // 2026-11-06 is a Friday.
    const friday = utc('2026-11-06T12:00:00Z');
    const monday = { every: 'week' as const, weekday: 1, at: '09:00' };
    expect(iso(computeNextRunAt(monday, 'Europe/Madrid', friday))).toBe('2026-11-09T08:00:00.000Z');
    const sunday = { every: 'week' as const, weekday: 0, at: '09:00' };
    expect(iso(computeNextRunAt(sunday, 'Europe/Madrid', friday))).toBe('2026-11-08T08:00:00.000Z');
    // Same weekday, time already passed: a week later.
    const fri = { every: 'week' as const, weekday: 5, at: '09:00' };
    expect(iso(computeNextRunAt(fri, 'Europe/Madrid', friday))).toBe('2026-11-13T08:00:00.000Z');
    expect(iso(computeNextRunAt(fri, 'Europe/Madrid', utc('2026-11-06T07:00:00Z')))).toBe(
      '2026-11-06T08:00:00.000Z',
    );
  });

  it('uses the local weekday, not the UTC one', () => {
    // Monday 00:30 in Tokyo is still Sunday in UTC.
    const monday = { every: 'week' as const, weekday: 1, at: '00:30' };
    expect(iso(computeNextRunAt(monday, 'Asia/Tokyo', utc('2026-11-06T12:00:00Z')))).toBe(
      '2026-11-08T15:30:00.000Z',
    );
  });

  it('runs on day 28 of every month, including February and year ends', () => {
    const m28 = { every: 'month' as const, dayOfMonth: 28, at: '09:00' };
    expect(iso(computeNextRunAt(m28, 'Europe/Madrid', utc('2026-02-10T00:00:00Z')))).toBe(
      '2026-02-28T08:00:00.000Z',
    );
    expect(iso(computeNextRunAt(m28, 'Europe/Madrid', utc('2026-02-28T08:00:00Z')))).toBe(
      '2026-03-28T08:00:00.000Z',
    );
    expect(iso(computeNextRunAt(m28, 'Europe/Madrid', utc('2026-12-28T08:00:00Z')))).toBe(
      '2027-01-28T08:00:00.000Z',
    );
    // Leap year: February 2028 still uses the 28th.
    expect(iso(computeNextRunAt(m28, 'Europe/Madrid', utc('2028-02-01T00:00:00Z')))).toBe(
      '2028-02-28T08:00:00.000Z',
    );
  });

  it('runs on day 1 and keeps the wall clock across a DST change', () => {
    const m1 = { every: 'month' as const, dayOfMonth: 1, at: '09:00' };
    expect(iso(computeNextRunAt(m1, 'Europe/Madrid', utc('2026-03-01T08:00:00Z')))).toBe(
      '2026-04-01T07:00:00.000Z',
    );
  });

  it('throws when the trigger can never fire', () => {
    expect(() => computeNextRunAt({ every: 'week', at: '09:00' }, 'UTC', 0)).toThrow();
  });
});

describe('localDateInZone and dateArrivesTargetDate', () => {
  it('reads the local calendar date', () => {
    const ms = utc('2026-11-06T23:30:00Z');
    expect(localDateInZone(ms, 'UTC')).toBe('2026-11-06');
    expect(localDateInZone(ms, 'Europe/Madrid')).toBe('2026-11-07');
    expect(localDateInZone(ms, 'America/New_York')).toBe('2026-11-06');
  });

  it('targets today - offsetDays (negative offset: before the date)', () => {
    expect(dateArrivesTargetDate('2026-11-06', -3)).toBe('2026-11-09');
    expect(dateArrivesTargetDate('2026-11-06', 0)).toBe('2026-11-06');
    expect(dateArrivesTargetDate('2026-11-06', 2)).toBe('2026-11-04');
  });

  it('crosses month and year boundaries and leap days', () => {
    expect(dateArrivesTargetDate('2026-11-29', -3)).toBe('2026-12-02');
    expect(dateArrivesTargetDate('2026-12-30', -3)).toBe('2027-01-02');
    expect(dateArrivesTargetDate('2027-01-02', 3)).toBe('2026-12-30');
    expect(dateArrivesTargetDate('2028-02-27', -2)).toBe('2028-02-29');
    expect(dateArrivesTargetDate('2027-03-01', 1)).toBe('2027-02-28');
    expect(dateArrivesTargetDate('2026-03-01', -30)).toBe('2026-03-31');
    expect(dateArrivesTargetDate('2026-03-01', 30)).toBe('2026-01-30');
  });
});

describe('dateKeysOf', () => {
  const columns = [
    { id: 'due', type: 'date' },
    { id: 'start', type: 'date' },
    { id: 'range', type: 'timeline' },
    { id: 'txt', type: 'text' },
  ];

  it('lists sorted unique columnId:date keys of date cells only', () => {
    expect(
      dateKeysOf(
        {
          start: { date: '2026-12-01', time: '10:00:00' },
          due: { date: '2026-11-30' },
          range: { from: '2026-11-01', to: '2026-11-05' },
          txt: '2026-01-01',
        },
        columns,
      ),
    ).toEqual(['due:2026-11-30', 'start:2026-12-01']);
  });

  it('skips empty, malformed and missing cells', () => {
    expect(dateKeysOf({ due: null, start: { date: 'nope' } }, columns)).toEqual([]);
    expect(dateKeysOf(undefined, columns)).toEqual([]);
    expect(dateKeysOf(null, columns)).toEqual([]);
  });
});

describe('run ids', () => {
  it('are deterministic', () => {
    expect(recurringRunId('a1', '2026-11-09T08:00:00.000Z')).toBe(
      'recurring:a1:2026-11-09T08:00:00.000Z',
    );
    expect(dateRunId('a1', 'i9', '2026-11-30')).toBe('date:a1:i9:2026-11-30');
  });
});
