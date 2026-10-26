import { describe, expect, it } from 'vitest';
import { columnRegistry, defineColumnType, textColumn } from './columns';
import {
  computeColumnIdLists,
  computeDerivedColumnIds,
  computeServerManagedColumnIds,
  nextColumnIdLists,
  nextDerivedColumnIds,
  nextServerManagedColumnIds,
} from './derived-ids';

// No production column type is derived yet, so the shared registry gets a test-only one.
columnRegistry.register(
  defineColumnType({
    ...textColumn,
    type: 'test_derived',
    label: 'Test derived',
    derived: true,
    compute: () => 'x',
  }),
);
// `button` is the production server-managed type; this one keeps these tests independent of it.
columnRegistry.register(
  defineColumnType({
    ...textColumn,
    type: 'test_managed',
    label: 'Test managed',
    serverManaged: true,
  }),
);

const col = (id: string, type: string) => ({
  id,
  type,
  title: id,
  position: 'a0',
  settings: {},
});

describe('computeDerivedColumnIds', () => {
  it('lists derived columns, sorted and without duplicates, from columns and subitem columns', () => {
    expect(
      computeDerivedColumnIds({
        columns: [col('z', 'test_derived'), col('t', 'text'), col('b', 'test_derived')],
        subitemColumns: [col('m', 'test_derived'), col('b', 'test_derived')],
      }),
    ).toEqual(['b', 'm', 'z']);
  });

  it('is empty without derived columns and ignores unknown types and malformed entries', () => {
    expect(computeDerivedColumnIds({ columns: [col('t', 'text'), col('u', 'nope')] })).toEqual([]);
    expect(
      computeDerivedColumnIds({
        columns: [
          null,
          42,
          { id: 1, type: 'test_derived' },
          { id: 'ok' },
          col('d', 'test_derived'),
        ],
      }),
    ).toEqual(['d']);
    expect(computeDerivedColumnIds({})).toEqual([]);
    expect(computeDerivedColumnIds({ columns: 'oops' })).toEqual([]);
  });
});

describe('nextDerivedColumnIds', () => {
  it('returns null when the stored list is already right, whatever its order', () => {
    const columns = [col('b', 'test_derived'), col('a', 'test_derived')];
    expect(nextDerivedColumnIds({ columns, derivedColumnIds: ['a', 'b'] })).toBeNull();
    expect(nextDerivedColumnIds({ columns, derivedColumnIds: ['b', 'a'] })).toBeNull();
    expect(nextDerivedColumnIds({ columns: [col('t', 'text')], derivedColumnIds: [] })).toBeNull();
  });

  it('returns the new list when it differs, is missing or is malformed', () => {
    const columns = [col('d', 'test_derived')];
    expect(nextDerivedColumnIds({ columns, derivedColumnIds: [] })).toEqual(['d']);
    expect(nextDerivedColumnIds({ columns })).toEqual(['d']);
    expect(nextDerivedColumnIds({ columns, derivedColumnIds: null })).toEqual(['d']);
    expect(nextDerivedColumnIds({ columns, derivedColumnIds: ['d', 'd'] })).toEqual(['d']);
    expect(nextDerivedColumnIds({ columns, derivedColumnIds: ['gone', 'd'] })).toEqual(['d']);
    expect(nextDerivedColumnIds({ columns, derivedColumnIds: ['d', 5] })).toEqual(['d']);
    expect(nextDerivedColumnIds({ columns: [col('t', 'text')], derivedColumnIds: ['t'] })).toEqual(
      [],
    );
  });

  it('backfills a legacy board that has no field, even with no derived columns', () => {
    expect(nextDerivedColumnIds({ columns: [col('t', 'text')] })).toEqual([]);
  });

  it('does not mutate the stored list it is given', () => {
    const stored = ['b', 'a'];
    nextDerivedColumnIds({ columns: [], derivedColumnIds: stored });
    expect(stored).toEqual(['b', 'a']);
  });
});

describe('computeServerManagedColumnIds (FW2)', () => {
  it('lists server-managed columns, sorted, from columns and subitem columns', () => {
    expect(
      computeServerManagedColumnIds({
        columns: [col('z', 'test_managed'), col('t', 'text'), col('b', 'button')],
        subitemColumns: [col('m', 'test_managed'), col('b', 'button')],
      }),
    ).toEqual(['b', 'm', 'z']);
  });

  it('keeps the two lists apart', () => {
    const columns = [col('d', 'test_derived'), col('m', 'test_managed'), col('t', 'text')];
    expect(computeColumnIdLists({ columns })).toEqual({
      derivedColumnIds: ['d'],
      serverManagedColumnIds: ['m'],
    });
  });

  it('is empty without such columns and tolerates malformed data', () => {
    expect(computeServerManagedColumnIds({ columns: [col('t', 'text')] })).toEqual([]);
    expect(computeServerManagedColumnIds({})).toEqual([]);
    expect(computeServerManagedColumnIds({ columns: 'oops', subitemColumns: [null] })).toEqual([]);
  });
});

describe('nextServerManagedColumnIds', () => {
  it('returns null when right, whatever the order, and the list when missing or wrong', () => {
    const columns = [col('b', 'test_managed'), col('a', 'test_managed')];
    expect(nextServerManagedColumnIds({ columns, serverManagedColumnIds: ['b', 'a'] })).toBeNull();
    expect(nextServerManagedColumnIds({ columns })).toEqual(['a', 'b']);
    expect(nextServerManagedColumnIds({ columns, serverManagedColumnIds: null })).toEqual([
      'a',
      'b',
    ]);
    expect(nextServerManagedColumnIds({ columns, serverManagedColumnIds: ['a'] })).toEqual([
      'a',
      'b',
    ]);
    expect(
      nextServerManagedColumnIds({ columns: [col('t', 'text')], serverManagedColumnIds: ['t'] }),
    ).toEqual([]);
  });
});

describe('nextColumnIdLists', () => {
  const columns = [col('d', 'test_derived'), col('m', 'test_managed')];
  const both = { derivedColumnIds: ['d'], serverManagedColumnIds: ['m'] };

  it('returns null only when both lists are right', () => {
    expect(
      nextColumnIdLists({ columns, derivedColumnIds: ['d'], serverManagedColumnIds: ['m'] }),
    ).toBeNull();
  });

  it('returns both lists when either one is wrong or missing', () => {
    expect(
      nextColumnIdLists({ columns, derivedColumnIds: ['d'], serverManagedColumnIds: [] }),
    ).toEqual(both);
    expect(
      nextColumnIdLists({ columns, derivedColumnIds: [], serverManagedColumnIds: ['m'] }),
    ).toEqual(both);
    // A board from before FW2 has the FW1 field only.
    expect(nextColumnIdLists({ columns, derivedColumnIds: ['d'] })).toEqual(both);
    expect(nextColumnIdLists({ columns })).toEqual(both);
  });

  it('backfills a board with no such columns to two empty lists', () => {
    expect(nextColumnIdLists({ columns: [col('t', 'text')], derivedColumnIds: [] })).toEqual({
      derivedColumnIds: [],
      serverManagedColumnIds: [],
    });
  });
});
