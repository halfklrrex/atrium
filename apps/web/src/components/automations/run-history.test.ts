import { describe, expect, it } from 'vitest';
import { scheduledRunInfo } from './run-history';

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
