import { describe, expect, it } from 'vitest';
import {
  CIRCUIT_BREAKER_FAILURES,
  MAX_RUNS_PER_HOUR,
  counterForNow,
  hourBucketOf,
  rateLimited,
  runExpiresAtMs,
  runIdOf,
} from './limits';
import { conditionsHold, matchAutomation, type MatchEntry } from './match';

const entry = (over: Partial<MatchEntry> = {}): MatchEntry => ({
  kind: 'value_changed',
  itemId: 'i1',
  columnId: 'status',
  groupId: 'g1',
  data: { toValue: { index: 1 } },
  ...over,
});

describe('matchAutomation', () => {
  it('item_created matches the kind, and the group when one is set', () => {
    const created = entry({ kind: 'item_created', columnId: null });
    expect(matchAutomation({ trigger: { type: 'item_created' } }, created)).toBe(true);
    expect(matchAutomation({ trigger: { type: 'item_created', groupId: 'g1' } }, created)).toBe(
      true,
    );
    expect(matchAutomation({ trigger: { type: 'item_created', groupId: 'g2' } }, created)).toBe(
      false,
    );
    expect(matchAutomation({ trigger: { type: 'item_created' } }, entry())).toBe(false);
  });

  it('status_changed compares the label index with the new value', () => {
    const t = (toLabelId?: number) => ({
      trigger: { type: 'status_changed' as const, columnId: 'status', toLabelId },
    });
    expect(matchAutomation(t(1), entry())).toBe(true);
    expect(matchAutomation(t(2), entry())).toBe(false);
    expect(matchAutomation(t(undefined), entry())).toBe(true);
    expect(matchAutomation(t(0), entry({ data: { toValue: { index: 0 } } }))).toBe(true);
    expect(matchAutomation(t(1), entry({ columnId: 'other' }))).toBe(false);
    expect(matchAutomation(t(1), entry({ kind: 'item_renamed' }))).toBe(false);
  });

  it('status_changed falls back to the item value when the entry kept no raw value', () => {
    const t = { trigger: { type: 'status_changed' as const, columnId: 'status', toLabelId: 2 } };
    const noValue = entry({ data: {} });
    expect(matchAutomation(t, noValue, { values: { status: { index: 2 } } })).toBe(true);
    expect(matchAutomation(t, noValue, { values: { status: { index: 1 } } })).toBe(false);
    expect(matchAutomation(t, noValue)).toBe(false);
  });

  it('button_clicked matches the kind and the button column', () => {
    const t = { trigger: { type: 'button_clicked' as const, columnId: 'btn' } };
    expect(matchAutomation(t, entry({ kind: 'button_clicked', columnId: 'btn' }))).toBe(true);
    expect(matchAutomation(t, entry({ kind: 'button_clicked', columnId: 'x' }))).toBe(false);
  });

  it('never matches an entry without an item or for a subitem', () => {
    const t = { trigger: { type: 'item_created' as const } };
    expect(matchAutomation(t, entry({ kind: 'item_created', itemId: null }))).toBe(false);
    expect(matchAutomation(t, entry({ kind: 'item_created', parentItemId: 'p' }))).toBe(false);
  });
});

describe('conditionsHold', () => {
  const item = {
    values: {
      status: { index: 1 },
      note: 'Hello',
      who: { personsAndTeams: [] },
      tags: { ids: [1] },
    },
  };
  it('is and is_not compare values', () => {
    expect(conditionsHold([{ columnId: 'note', op: 'is', value: 'Hello' }], item)).toBe(true);
    expect(conditionsHold([{ columnId: 'note', op: 'is', value: 'Nope' }], item)).toBe(false);
    expect(conditionsHold([{ columnId: 'note', op: 'is_not', value: 'Nope' }], item)).toBe(true);
    expect(conditionsHold([{ columnId: 'status', op: 'is', value: { index: 1 } }], item)).toBe(
      true,
    );
    expect(conditionsHold([{ columnId: 'status', op: 'is', value: 1 }], item)).toBe(true);
  });
  it('is_empty and is_not_empty understand empty cells', () => {
    expect(conditionsHold([{ columnId: 'missing', op: 'is_empty' }], item)).toBe(true);
    expect(conditionsHold([{ columnId: 'who', op: 'is_empty' }], item)).toBe(true);
    expect(conditionsHold([{ columnId: 'tags', op: 'is_not_empty' }], item)).toBe(true);
    expect(conditionsHold([{ columnId: 'note', op: 'is_empty' }], item)).toBe(false);
  });
  it('needs every condition, and an empty list holds', () => {
    expect(conditionsHold([], item)).toBe(true);
    expect(
      conditionsHold(
        [
          { columnId: 'note', op: 'is', value: 'Hello' },
          { columnId: 'note', op: 'is_empty' },
        ],
        item,
      ),
    ).toBe(false);
  });
});

describe('limits', () => {
  it('buckets by ISO hour and resets a stale counter', () => {
    const t = Date.UTC(2026, 10, 4, 9, 30);
    expect(hourBucketOf(t)).toBe('2026-11-04T09');
    expect(counterForNow(null, t)).toEqual({ hourBucket: '2026-11-04T09', runs: 0 });
    expect(counterForNow({ hourBucket: '2026-11-04T09', runs: 7 }, t).runs).toBe(7);
    expect(counterForNow({ hourBucket: '2026-11-04T08', runs: 99 }, t).runs).toBe(0);
  });
  it('limits at the hourly maximum', () => {
    expect(rateLimited({ hourBucket: 'x', runs: MAX_RUNS_PER_HOUR - 1 })).toBe(false);
    expect(rateLimited({ hourBucket: 'x', runs: MAX_RUNS_PER_HOUR })).toBe(true);
  });
  it('builds ids and expiry', () => {
    expect(runIdOf('a1', 'e1')).toBe('a1-e1');
    expect(runExpiresAtMs(0)).toBe(30 * 24 * 60 * 60 * 1000);
    expect(CIRCUIT_BREAKER_FAILURES).toBe(10);
  });
});
