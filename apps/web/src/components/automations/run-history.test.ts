import { describe, expect, it } from 'vitest';
import { formatRunTime, scheduledRunInfo } from './run-history';

describe('formatRunTime', () => {
  const at = (...args: [number, number, number, number, number]) => ({
    toMillis: () => new Date(...args).getTime(),
  });
  const now = new Date(2026, 10, 7, 16, 0).getTime();

  it('says Today and Yesterday with a 24-hour time', () => {
    expect(formatRunTime(at(2026, 10, 7, 14, 32), now, 'en-US')).toBe('Today 14:32');
    expect(formatRunTime(at(2026, 10, 6, 17, 18), now, 'en-US')).toBe('Yesterday 17:18');
  });

  it('reads yesterday by calendar day, not by 24 hours', () => {
    expect(formatRunTime(at(2026, 10, 6, 23, 59), now, 'en-US')).toBe('Yesterday 23:59');
  });

  it('falls back to the short date and time', () => {
    expect(formatRunTime(at(2026, 10, 3, 15, 11), now, 'en-US')).toBe('Nov 3, 15:11');
  });
});

describe('scheduledRunInfo', () => {
  it('reads the instant of a recurring run from its id', () => {
    const info = scheduledRunInfo({ id: 'recurring:a1:2026-11-09T08:00:00.000Z', eventId: 'e' });
    expect(info?.kind).toBe('recurring');
    expect(info?.label).toMatch(/^Scheduled for .*2026/);
  });

  it('reads the date of a date-arrives run, also from the event id', () => {
    expect(scheduledRunInfo({ id: 'a1-e', eventId: 'date:a1:i1:2026-11-09' })).toEqual({
      kind: 'date',
      label: 'Scheduled for 2026-11-09',
    });
  });

  it('degrades to a plain label when the id does not parse, and is null for event runs', () => {
    expect(scheduledRunInfo({ id: 'recurring:a1:nope', eventId: 'e' })?.label).toBe('Scheduled');
    expect(scheduledRunInfo({ id: 'date:a1:i1:soon', eventId: 'e' })?.label).toBe('Scheduled');
    expect(scheduledRunInfo({ id: 'a1-e1', eventId: 'e1' })).toBeNull();
  });
});
