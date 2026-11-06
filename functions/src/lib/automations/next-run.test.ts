import { computeNextRunAt } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { nextRunAtFix, syncNextRunAt, type NextRunStore } from './next-run';

const ts = (ms: number) => ({ toMillis: () => ms });
const NOW = Date.UTC(2026, 10, 4, 10, 0); // 11:00 in Madrid
const trigger = { type: 'recurring', every: 'day', at: '09:00' };
const recipe = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  trigger,
  timezone: 'Europe/Madrid',
  ...over,
});
const NEXT = Date.UTC(2026, 10, 5, 8, 0);

describe('nextRunAtFix', () => {
  it('sets the next occurrence of an enabled recurring recipe that has none', () => {
    expect(nextRunAtFix(recipe(), NOW)).toBe(NEXT);
    expect(nextRunAtFix(recipe({ nextRunAt: null }), NOW)).toBe(NEXT);
  });

  it('leaves a right value alone, also when it is already due', () => {
    expect(nextRunAtFix(recipe({ nextRunAt: ts(NEXT) }), NOW)).toBeUndefined();
    const due = Date.UTC(2026, 10, 3, 8, 0);
    expect(nextRunAtFix(recipe({ nextRunAt: ts(due) }), NOW)).toBeUndefined();
  });

  it('recomputes when the schedule or the zone was edited', () => {
    const stored = recipe({ nextRunAt: ts(NEXT) });
    expect(nextRunAtFix({ ...stored, trigger: { ...trigger, at: '10:30' } }, NOW)).toBe(
      computeNextRunAt({ every: 'day', at: '10:30' }, 'Europe/Madrid', NOW),
    );
    expect(nextRunAtFix({ ...stored, timezone: 'America/New_York' }, NOW)).toBe(
      computeNextRunAt({ every: 'day', at: '09:00' }, 'America/New_York', NOW),
    );
    expect(
      nextRunAtFix(
        { ...stored, trigger: { type: 'recurring', every: 'week', weekday: 1, at: '09:00' } },
        NOW,
      ),
    ).toBe(computeNextRunAt({ every: 'week', weekday: 1, at: '09:00' }, 'Europe/Madrid', NOW));
  });

  it('clears the value when the recipe is disabled or is not recurring', () => {
    expect(nextRunAtFix(recipe({ enabled: false, nextRunAt: ts(NEXT) }), NOW)).toBeNull();
    expect(
      nextRunAtFix({ enabled: true, trigger: { type: 'item_created' }, nextRunAt: ts(NEXT) }, NOW),
    ).toBeNull();
  });

  it('writes nothing for a recipe that has no schedule and no value', () => {
    expect(nextRunAtFix(recipe({ enabled: false }), NOW)).toBeUndefined();
    expect(nextRunAtFix(recipe({ enabled: false, nextRunAt: null }), NOW)).toBeUndefined();
    expect(nextRunAtFix({ enabled: true, trigger: { type: 'item_created' } }, NOW)).toBeUndefined();
    expect(nextRunAtFix(undefined, NOW)).toBeUndefined();
  });

  it('does not throw on an unknown time zone', () => {
    expect(nextRunAtFix(recipe({ timezone: 'Mars/Base' }), NOW)).toBeUndefined();
    expect(nextRunAtFix(recipe({ timezone: 'Mars/Base', nextRunAt: ts(NEXT) }), NOW)).toBeNull();
  });
});

describe('syncNextRunAt', () => {
  class FakeStore implements NextRunStore {
    writes: Array<number | null> = [];
    constructor(public doc: Record<string, unknown>) {}
    async update(
      _b: string,
      _a: string,
      decide: (data: Record<string, unknown>) => number | null | undefined,
    ) {
      const next = decide(this.doc);
      if (next === undefined) return undefined;
      this.writes.push(next);
      this.doc = { ...this.doc, nextRunAt: next === null ? null : ts(next) };
      return next;
    }
  }

  it('is loop safe: its own write re-triggers it once and then it stops', async () => {
    const store = new FakeStore(recipe());
    expect(await syncNextRunAt(store, 'b1', 'r1', store.doc, NOW)).toBe(NEXT);
    // The retrigger carries the written document.
    expect(await syncNextRunAt(store, 'b1', 'r1', store.doc, NOW)).toBeUndefined();
    expect(await syncNextRunAt(store, 'b1', 'r1', store.doc, NOW + 60_000)).toBeUndefined();
    expect(store.writes).toEqual([NEXT]);
  });

  it('does not touch the store when the event data is already right', async () => {
    const store = new FakeStore(recipe({ nextRunAt: ts(NEXT) }));
    expect(await syncNextRunAt(store, 'b1', 'r1', store.doc, NOW)).toBeUndefined();
    expect(store.writes).toEqual([]);
  });

  it('decides on the current document, not on a stale event', async () => {
    // The event says "no value", but the scheduler already advanced the stored one.
    const store = new FakeStore(recipe({ nextRunAt: ts(NEXT) }));
    expect(await syncNextRunAt(store, 'b1', 'r1', recipe(), NOW)).toBeUndefined();
    expect(store.writes).toEqual([]);
  });

  it('ignores a deleted recipe', async () => {
    const store = new FakeStore(recipe());
    expect(await syncNextRunAt(store, 'b1', 'r1', undefined, NOW)).toBeUndefined();
    expect(store.writes).toEqual([]);
  });
});
