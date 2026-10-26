import { describe, expect, it } from 'vitest';
import {
  checkboxColumn,
  columnRegistry,
  dateColumn,
  dropdownColumn,
  isChecked,
  linkColumn,
  longTextColumn,
  numbersColumn,
  peopleColumn,
} from './index';

describe('every core column type', () => {
  it.each(columnRegistry.list().map((t) => [t.type] as const))(
    '%s has default settings that satisfy its own schema',
    (type) => {
      expect(columnRegistry.parseSettings(type, columnRegistry.defaultSettings(type)).success).toBe(
        true,
      );
    },
  );
});

describe('people column', () => {
  const settings = peopleColumn.defaultSettings();

  it('accepts monday personsAndTeams values with person and team kinds', () => {
    const ok = {
      personsAndTeams: [
        { id: 'u1', kind: 'person' },
        { id: 't1', kind: 'team' },
      ],
    };
    expect(peopleColumn.valueSchema.safeParse(ok).success).toBe(true);
    expect(peopleColumn.valueSchema.safeParse({ personsAndTeams: [{ id: 'u1' }] }).success).toBe(
      false,
    );
    expect(
      peopleColumn.valueSchema.safeParse({ personsAndTeams: [{ id: 'u1', kind: 'robot' }] })
        .success,
    ).toBe(false);
    expect(peopleColumn.valueSchema.safeParse({}).success).toBe(false);
  });

  it('renders ids and sorts by number of people, then ids', () => {
    const one = { personsAndTeams: [{ id: 'b', kind: 'person' as const }] };
    const oneA = { personsAndTeams: [{ id: 'a', kind: 'person' as const }] };
    const two = {
      personsAndTeams: [
        { id: 'a', kind: 'person' as const },
        { id: 'b', kind: 'person' as const },
      ],
    };
    expect(peopleColumn.toText(two, settings)).toBe('a, b');
    expect([two, one, oneA].sort((x, y) => peopleColumn.compare(x, y, settings))).toEqual([
      oneA,
      one,
      two,
    ]);
  });
});

describe('date column', () => {
  const settings = dateColumn.defaultSettings();

  it('accepts monday date values, with or without a time', () => {
    expect(dateColumn.valueSchema.safeParse({ date: '2019-06-03' }).success).toBe(true);
    expect(dateColumn.valueSchema.safeParse({ date: '2019-06-03', time: '13:25:00' }).success).toBe(
      true,
    );
    expect(dateColumn.valueSchema.safeParse({ date: '2019-06-03', time: null }).success).toBe(true);
  });

  it('rejects impossible dates and malformed times', () => {
    expect(dateColumn.valueSchema.safeParse({ date: '2019-02-30' }).success).toBe(false);
    expect(dateColumn.valueSchema.safeParse({ date: '03/06/2019' }).success).toBe(false);
    expect(dateColumn.valueSchema.safeParse({ date: '2019-06-03', time: '25:00:00' }).success).toBe(
      false,
    );
    expect(dateColumn.valueSchema.safeParse({ date: '2020-02-29' }).success).toBe(true);
  });

  it('renders monday-style text and sorts chronologically', () => {
    expect(dateColumn.toText({ date: '2019-06-03' }, settings)).toBe('2019-06-03');
    expect(dateColumn.toText({ date: '2019-06-03', time: '13:25:00' }, settings)).toBe(
      '2019-06-03 13:25:00',
    );
    const sorted = [
      { date: '2020-01-01' },
      { date: '2019-06-03', time: '13:25:00' },
      { date: '2019-06-03' },
    ].sort((a, b) => dateColumn.compare(a, b, settings));
    expect(sorted.map((d) => d.date)).toEqual(['2019-06-03', '2019-06-03', '2020-01-01']);
    expect(sorted[0]).toEqual({ date: '2019-06-03' });
  });
});

describe('numbers column', () => {
  it('accepts numeric strings (monday) and finite numbers, nothing else', () => {
    expect(numbersColumn.valueSchema.safeParse('42').success).toBe(true);
    expect(numbersColumn.valueSchema.safeParse('-3.25').success).toBe(true);
    expect(numbersColumn.valueSchema.safeParse(7).success).toBe(true);
    expect(numbersColumn.valueSchema.safeParse('abc').success).toBe(false);
    expect(numbersColumn.valueSchema.safeParse('1e5').success).toBe(false);
    expect(numbersColumn.valueSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });

  it('formats with unit and decimals and compares numerically', () => {
    const plain = numbersColumn.defaultSettings();
    expect(numbersColumn.toText('1250.5', plain)).toBe('1250.5');
    const money = { unit: { symbol: '$', direction: 'left' as const }, decimals: 2 };
    expect(numbersColumn.toText('1250.5', money)).toBe('$1250.50');
    const kg = { unit: { symbol: 'kg', direction: 'right' as const }, decimals: 0 };
    expect(numbersColumn.toText(3, kg)).toBe('3kg');
    expect(numbersColumn.compare('10', '9', plain)).toBeGreaterThan(0);
    expect(numbersColumn.compare(2, '2', plain)).toBe(0);
  });

  it('rejects out-of-range decimals in settings', () => {
    expect(numbersColumn.settingsSchema.safeParse({ unit: null, decimals: 12 }).success).toBe(
      false,
    );
  });
});

describe('dropdown column', () => {
  const settings = {
    labels: [
      { id: 1, label: 'Design' },
      { id: 2, label: 'Build' },
    ],
    limitSelect: false,
  };

  it('accepts monday ids values and rejects duplicate label ids in settings', () => {
    expect(dropdownColumn.valueSchema.safeParse({ ids: [1, 2] }).success).toBe(true);
    expect(dropdownColumn.valueSchema.safeParse({ ids: ['1'] }).success).toBe(false);
    expect(dropdownColumn.settingsSchema.safeParse(settings).success).toBe(true);
    expect(
      dropdownColumn.settingsSchema.safeParse({
        labels: [
          { id: 1, label: 'A' },
          { id: 1, label: 'B' },
        ],
        limitSelect: false,
      }).success,
    ).toBe(false);
  });

  it('renders selected labels, skipping ids that no longer exist', () => {
    expect(dropdownColumn.toText({ ids: [2, 1] }, settings)).toBe('Build, Design');
    expect(dropdownColumn.toText({ ids: [2, 99] }, settings)).toBe('Build');
    expect(dropdownColumn.compare({ ids: [2] }, { ids: [1] }, settings)).toBeLessThan(0);
  });
});

describe('checkbox column', () => {
  const settings = checkboxColumn.defaultSettings();

  it('uses monday string booleans and tolerates real booleans', () => {
    expect(checkboxColumn.valueSchema.safeParse({ checked: 'true' }).success).toBe(true);
    expect(checkboxColumn.valueSchema.safeParse({ checked: 'false' }).success).toBe(true);
    expect(checkboxColumn.valueSchema.safeParse({ checked: true }).success).toBe(true);
    expect(checkboxColumn.valueSchema.safeParse({ checked: 'yes' }).success).toBe(false);
    expect(isChecked({ checked: 'true' })).toBe(true);
    expect(isChecked({ checked: false })).toBe(false);
  });

  it('renders "v" when ticked and sorts unticked first', () => {
    expect(checkboxColumn.toText({ checked: 'true' }, settings)).toBe('v');
    expect(checkboxColumn.toText({ checked: 'false' }, settings)).toBe('');
    expect(
      checkboxColumn.compare({ checked: 'true' }, { checked: 'false' }, settings),
    ).toBeGreaterThan(0);
  });
});

describe('link column', () => {
  const settings = linkColumn.defaultSettings();

  it('accepts safe links only', () => {
    expect(linkColumn.valueSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
    expect(
      linkColumn.valueSchema.safeParse({ url: 'mailto:a@example.com', text: 'Mail' }).success,
    ).toBe(true);
    expect(linkColumn.valueSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(linkColumn.valueSchema.safeParse({ url: 'data:text/html,hi' }).success).toBe(false);
    expect(linkColumn.valueSchema.safeParse({ url: 'not a url' }).success).toBe(false);
  });

  it('renders "text - url" or just the url', () => {
    expect(linkColumn.toText({ url: 'https://a.io', text: 'A' }, settings)).toBe(
      'A - https://a.io',
    );
    expect(linkColumn.toText({ url: 'https://a.io' }, settings)).toBe('https://a.io');
  });
});

describe('long text column', () => {
  const settings = longTextColumn.defaultSettings();

  it('accepts the monday {text, changed_at} shape', () => {
    expect(
      longTextColumn.valueSchema.safeParse({ text: 'hi', changed_at: '2019-06-03T13:25:00.000Z' })
        .success,
    ).toBe(true);
    expect(longTextColumn.valueSchema.safeParse('hi').success).toBe(false);
    expect(longTextColumn.toText({ text: 'a\nb' }, settings)).toBe('a\nb');
    expect(longTextColumn.compare({ text: 'a' }, { text: 'b' }, settings)).toBeLessThan(0);
  });
});
