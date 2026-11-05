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

describe('label-only status values', () => {
  const columns = [
    {
      id: 'status',
      settings: {
        labels: [
          { id: 'w', index: 0, label: 'Working on it', color: '#fdab3d' },
          { id: 'd', index: 1, label: 'Done', color: '#00c875' },
        ],
      },
    },
  ];
  const t = (toLabelId: number) => ({
    trigger: { type: 'status_changed' as const, columnId: 'status', toLabelId },
  });
  const labelEntry = (label: string) => entry({ data: { toValue: { label } } });

  it('status_changed resolves the label through the column settings', () => {
    expect(matchAutomation(t(1), labelEntry('Done'), null, columns)).toBe(true);
    expect(matchAutomation(t(1), labelEntry(' done '), null, columns)).toBe(true);
    expect(matchAutomation(t(0), labelEntry('Done'), null, columns)).toBe(false);
    // Without settings a label cannot be resolved.
    expect(matchAutomation(t(1), labelEntry('Done'))).toBe(false);
    // Index values still work with settings present.
    expect(matchAutomation(t(1), entry(), null, columns)).toBe(true);
  });

  it('is and is_not compare a label-only cell with an index or label value', () => {
    const item = { values: { status: { label: 'Done' } } };
    const is = (value: unknown) => [{ columnId: 'status', op: 'is' as const, value }];
    expect(conditionsHold(is({ index: 1 }), item, columns)).toBe(true);
    expect(conditionsHold(is(1), item, columns)).toBe(true);
    expect(conditionsHold(is({ index: 0 }), item, columns)).toBe(false);
    expect(
      conditionsHold([{ columnId: 'status', op: 'is_not', value: { index: 1 } }], item, columns),
    ).toBe(false);
    const byIndex = { values: { status: { index: 1 } } };
    expect(conditionsHold(is({ label: 'Done' }), byIndex, columns)).toBe(true);
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

describe('matchAutomation: item_moved and person_assigned', () => {
  const moved = (over: Partial<MatchEntry> = {}) =>
    entry({
      kind: 'item_moved',
      columnId: null,
      groupId: 'g2',
      data: { fromGroupId: 'g1' },
      ...over,
    });
  const people = (...uids: string[]) => ({
    personsAndTeams: uids.map((id) => ({ id, kind: 'person' as const })),
  });
  const assigned = (from: unknown, to: unknown, over: Partial<MatchEntry> = {}) =>
    entry({ columnId: 'owner', data: { fromValue: from, toValue: to }, ...over });
  const trigger = (uid?: string) => ({
    trigger: { type: 'person_assigned' as const, columnId: 'owner', uid },
  });

  it.each([
    ['any move', undefined, moved(), true],
    ['the destination group', 'g2', moved(), true],
    ['another destination group', 'g3', moved(), false],
    ['not a move', undefined, entry(), false],
    ['a subitem move', undefined, moved({ parentItemId: 'p1' }), false],
  ])('item_moved: %s', (_name, groupId, e, expected) => {
    expect(matchAutomation({ trigger: { type: 'item_moved', groupId } }, e)).toBe(expected);
  });

  it.each([
    ['adds someone to an empty cell', trigger(), assigned(null, people('u1')), true],
    ['adds a second person', trigger(), assigned(people('u1'), people('u1', 'u2')), true],
    ['only removes someone', trigger(), assigned(people('u1', 'u2'), people('u1')), false],
    ['no change in the people', trigger(), assigned(people('u1'), people('u1')), false],
    [
      'a team is added',
      trigger(),
      assigned(null, { personsAndTeams: [{ id: 't', kind: 'team' }] }),
      false,
    ],
    ['the chosen person is added', trigger('u2'), assigned(people('u1'), people('u1', 'u2')), true],
    ['another person is added', trigger('u3'), assigned(people('u1'), people('u1', 'u2')), false],
    ['another column', trigger(), assigned(null, people('u1'), { columnId: 'other' }), false],
    ['not a value change', trigger(), assigned(null, people('u1'), { kind: 'item_moved' }), false],
    [
      'a dropped from value',
      trigger(),
      entry({ columnId: 'owner', data: { toValue: people('u1') } }),
      false,
    ],
    ['no values at all', trigger(), entry({ columnId: 'owner', data: {} }), false],
  ])('person_assigned: %s', (_name, t, e, expected) => {
    expect(matchAutomation(t, e)).toBe(expected);
  });

  it('person_assigned falls back to the item value when the new raw value was dropped', () => {
    const e = entry({ columnId: 'owner', data: { fromValue: null } });
    expect(matchAutomation(trigger(), e, { values: { owner: people('u1') } })).toBe(true);
    expect(matchAutomation(trigger(), e, { values: {} })).toBe(false);
  });
});
