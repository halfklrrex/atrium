import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '../schemas/board';
import {
  columnTypeChangeSupport,
  conversionSamples,
  convertValue,
  findColumnDependents,
  parseDateText,
  parseNumberText,
  planColumnConversion,
} from './convert';
import { columnRegistry } from './index';

const col = (type: string, settings: unknown = columnRegistry.defaultSettings(type)) => ({
  type,
  settings: settings as Record<string, unknown>,
});
const defaults = (type: string) => columnRegistry.defaultSettings(type);

const statusSettings = {
  labels: [
    { id: 'done', index: 1, label: 'Done', color: '#00c875' },
    { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
  ],
};
const dropdownSettings = {
  labels: [
    { id: 1, label: 'Red' },
    { id: 2, label: 'Blue' },
  ],
  limitSelect: false,
};

function ok(result: ReturnType<typeof convertValue>): unknown {
  expect(result.ok).toBe(true);
  return result.ok ? result.value : undefined;
}

describe('numbers <-> text', () => {
  it('writes the display text, with the unit', () => {
    const from = col('numbers', { unit: { symbol: '$', direction: 'left' }, decimals: 2 });
    expect(ok(convertValue(from, 'text', {}, 42))).toBe('$42.00');
  });

  it('parses a number with a unit or currency suffix and thousands separators', () => {
    const from = col('text');
    expect(ok(convertValue(from, 'numbers', defaults('numbers'), '$1,200.50'))).toBe(1200.5);
    expect(ok(convertValue(from, 'numbers', defaults('numbers'), '12 kg'))).toBe(12);
    expect(ok(convertValue(from, 'numbers', defaults('numbers'), '-7'))).toBe(-7);
    expect(ok(convertValue(from, 'numbers', defaults('numbers'), '-$7.5'))).toBe(-7.5);
  });

  it('clears text that is not a number', () => {
    const from = col('text');
    for (const text of ['abc', '1.2.3', '12 34', '']) {
      expect(convertValue(from, 'numbers', defaults('numbers'), text).ok).toBe(false);
    }
  });

  it('parseNumberText rejects huge and malformed input', () => {
    expect(parseNumberText('1e5')).toBeNull();
    expect(parseNumberText('99999999999999999999')).toBeNull();
    expect(parseNumberText('.5')).toBe(0.5);
  });
});

describe('date <-> text and timeline', () => {
  it('writes the date as text and parses ISO and written dates', () => {
    expect(ok(convertValue(col('date'), 'text', {}, { date: '2026-03-04' }))).toBe('2026-03-04');
    expect(
      ok(convertValue(col('date'), 'text', {}, { date: '2026-03-04', time: '10:00:00' })),
    ).toBe('2026-03-04 10:00:00');
    const text = col('text');
    expect(ok(convertValue(text, 'date', defaults('date'), '2026-03-04'))).toEqual({
      date: '2026-03-04',
    });
    expect(ok(convertValue(text, 'date', defaults('date'), '4 March 2026'))).toEqual({
      date: '2026-03-04',
    });
    expect(ok(convertValue(text, 'date', defaults('date'), 'Mar 4, 2026'))).toEqual({
      date: '2026-03-04',
    });
    expect(ok(convertValue(text, 'date', defaults('date'), '2026-03-04 09:30'))).toEqual({
      date: '2026-03-04',
      time: '09:30:00',
    });
  });

  it('refuses dates with two readings or that do not exist', () => {
    const text = col('text');
    expect(convertValue(text, 'date', defaults('date'), '03/04/2026').ok).toBe(false);
    expect(parseDateText('25/12/2026')).toEqual({ date: '2026-12-25' });
    expect(parseDateText('12/25/2026')).toEqual({ date: '2026-12-25' });
    expect(parseDateText('2026-02-30')).toBeNull();
    expect(parseDateText('soon')).toBeNull();
  });

  it('date -> timeline is a one-day span and timeline -> date keeps the start', () => {
    expect(
      ok(convertValue(col('date'), 'timeline', defaults('timeline'), { date: '2026-03-04' })),
    ).toEqual({
      from: '2026-03-04',
      to: '2026-03-04',
    });
    expect(
      ok(
        convertValue(col('timeline'), 'date', defaults('date'), {
          from: '2026-03-04',
          to: '2026-03-09',
        }),
      ),
    ).toEqual({ date: '2026-03-04' });
  });

  it('text -> timeline reads a span or a single date', () => {
    const text = col('text');
    expect(
      ok(convertValue(text, 'timeline', defaults('timeline'), '2026-03-04 - 2026-03-09')),
    ).toEqual({
      from: '2026-03-04',
      to: '2026-03-09',
    });
    expect(ok(convertValue(text, 'timeline', defaults('timeline'), '2026-03-04'))).toEqual({
      from: '2026-03-04',
      to: '2026-03-04',
    });
    expect(convertValue(text, 'timeline', defaults('timeline'), '2026-03-09 - 2026-03-04').ok).toBe(
      false,
    );
  });
});

describe('checkbox <-> text', () => {
  it('reads true, yes, a tick and 1 as checked', () => {
    const text = col('text');
    for (const word of ['true', 'Yes', '✓', '1', ' TRUE ']) {
      expect(ok(convertValue(text, 'checkbox', {}, word))).toEqual({ checked: 'true' });
    }
    expect(ok(convertValue(text, 'checkbox', {}, 'no'))).toEqual({ checked: 'false' });
    expect(convertValue(text, 'checkbox', {}, 'maybe').ok).toBe(false);
  });

  it('writes Yes for a ticked box and clears an unticked one', () => {
    expect(ok(convertValue(col('checkbox'), 'text', {}, { checked: 'true' }))).toBe('Yes');
    expect(convertValue(col('checkbox'), 'text', {}, { checked: 'false' }).ok).toBe(false);
  });
});

describe('status, dropdown, tags and text map by label', () => {
  it('status -> text uses the label', () => {
    expect(ok(convertValue(col('status', statusSettings), 'text', {}, { index: 1 }))).toBe('Done');
  });

  it('text -> status reuses an existing label (any case) and creates a missing one', () => {
    const text = col('text');
    expect(ok(convertValue(text, 'status', statusSettings, 'done'))).toEqual({ index: 1 });
    const plan = planColumnConversion(text, 'status', statusSettings, [
      { id: 'a', value: 'Blocked' },
      { id: 'b', value: 'Blocked' },
      { id: 'c', value: 'Review' },
    ]);
    const labels = (
      plan.settings as {
        labels: Array<{ id: string; label: string; index: number; color: string }>;
      }
    ).labels;
    expect(labels.map((l) => l.label)).toEqual(['Done', 'Stuck', 'Blocked', 'Review']);
    expect(labels[2]!.index).toBe(3);
    expect(labels[3]!.index).toBe(4);
    // Colours come from the palette in order, skipping the ones the labels already use.
    expect(labels[2]!.color).toBe('#fdab3d');
    expect(labels[3]!.color).toBe('#579bfc');
    expect(new Set(labels.map((l) => l.id)).size).toBe(4);
    expect(plan.results.map((r) => r.ok && (r.value as { index: number }).index)).toEqual([
      3, 3, 4,
    ]);
    expect(columnRegistry.parseSettings('status', plan.settings).success).toBe(true);
  });

  it('does not change the settings it was given', () => {
    const settings = JSON.parse(JSON.stringify(statusSettings));
    planColumnConversion(col('text'), 'status', settings, [{ id: 'a', value: 'New' }]);
    expect(settings).toEqual(statusSettings);
  });

  it('dropdown -> status takes the first label; status -> dropdown creates labels', () => {
    expect(
      ok(
        convertValue(col('dropdown', dropdownSettings), 'status', statusSettings, { ids: [2, 1] }),
      ),
    ).toEqual({ index: expect.any(Number) });
    const plan = planColumnConversion(col('status', statusSettings), 'dropdown', dropdownSettings, [
      { id: 'a', value: { index: 1 } },
    ]);
    const labels = (plan.settings as { labels: Array<{ id: number; label: string }> }).labels;
    expect(labels.at(-1)).toEqual({ id: 3, label: 'Done' });
    expect(plan.results[0]).toEqual({ id: 'a', ok: true, value: { ids: [3] } });
  });

  it('text -> dropdown splits on commas, dedupes, and respects limitSelect', () => {
    const text = col('text');
    expect(ok(convertValue(text, 'dropdown', dropdownSettings, 'red, Blue, red'))).toEqual({
      ids: [1, 2],
    });
    expect(
      ok(convertValue(text, 'dropdown', { ...dropdownSettings, limitSelect: true }, 'red, Blue')),
    ).toEqual({ ids: [1] });
  });

  it('tags <-> dropdown map by label', () => {
    const tags = col('tags', {
      tags: [
        { id: 5, name: 'Red' },
        { id: 9, name: 'Green' },
      ],
    });
    const plan = planColumnConversion(tags, 'dropdown', dropdownSettings, [
      { id: 'a', value: { tag_ids: [5, 9] } },
    ]);
    expect(plan.results[0]).toEqual({ id: 'a', ok: true, value: { ids: [1, 3] } });
    const back = convertValue(
      col('dropdown', dropdownSettings),
      'tags',
      { tags: [] },
      { ids: [1, 2] },
    );
    expect(back.ok && back.value).toEqual({ tag_ids: [1, 2] });
  });

  it('refuses a label longer than the target allows and a full label list', () => {
    const long = 'x'.repeat(61);
    expect(convertValue(col('text'), 'status', statusSettings, long).ok).toBe(false);
    const full = {
      labels: Array.from({ length: 40 }, (_, i) => ({
        id: `l${i}`,
        index: i,
        label: `L${i}`,
        color: '#c4c4c4',
      })),
    };
    expect(convertValue(col('text'), 'status', full, 'Brand new').ok).toBe(false);
    expect(convertValue(col('text'), 'status', full, 'L7').ok).toBe(true);
  });
});

describe('email, phone, link and text', () => {
  it('converts both ways', () => {
    expect(ok(convertValue(col('email'), 'text', {}, { email: 'avery@example.com' }))).toBe(
      'avery@example.com',
    );
    expect(ok(convertValue(col('text'), 'email', {}, 'avery@example.com'))).toEqual({
      email: 'avery@example.com',
    });
    expect(ok(convertValue(col('text'), 'email', {}, 'Avery Quinn <avery@example.com>'))).toEqual({
      email: 'avery@example.com',
      text: 'Avery Quinn',
    });
    expect(convertValue(col('text'), 'email', {}, 'not an email').ok).toBe(false);
    expect(ok(convertValue(col('phone'), 'text', {}, { phone: '+44 20 7946 0000' }))).toBe(
      '+44 20 7946 0000',
    );
    expect(ok(convertValue(col('text'), 'phone', {}, '+44 20 7946 0000'))).toEqual({
      phone: '+44 20 7946 0000',
    });
    expect(convertValue(col('text'), 'phone', {}, 'call me').ok).toBe(false);
    expect(
      ok(convertValue(col('link'), 'text', {}, { url: 'https://example.com', text: 'Site' })),
    ).toBe('Site - https://example.com');
    expect(ok(convertValue(col('text'), 'link', {}, 'Site - https://example.com'))).toEqual({
      url: 'https://example.com',
      text: 'Site',
    });
    expect(ok(convertValue(col('text'), 'link', {}, 'example.com/page'))).toEqual({
      url: 'https://example.com/page',
    });
    expect(convertValue(col('text'), 'link', {}, 'javascript:alert(1)').ok).toBe(false);
  });

  it('email <-> phone goes through the text', () => {
    expect(convertValue(col('email'), 'phone', {}, { email: 'avery@example.com' }).ok).toBe(false);
  });

  it('text <-> long text', () => {
    expect(ok(convertValue(col('text'), 'long_text', {}, 'hello'))).toEqual({ text: 'hello' });
    expect(ok(convertValue(col('long_text'), 'text', {}, { text: 'hello' }))).toBe('hello');
  });
});

describe('people', () => {
  const people = col('people');
  const value = {
    personsAndTeams: [
      { id: 'uid-1', kind: 'person' },
      { id: 'uid-2', kind: 'person' },
      { id: 'team-1', kind: 'team' },
    ],
  };

  it('converts to text with the names it knows, and never writes an id', () => {
    const names = { 'uid-1': 'Avery Quinn', 'uid-2': 'Blake Rowan' };
    expect(ok(convertValue(people, 'text', {}, value, { personNames: names }))).toBe(
      'Avery Quinn, Blake Rowan',
    );
    expect(convertValue(people, 'text', {}, value).ok).toBe(false);
    expect(
      convertValue(
        people,
        'text',
        {},
        { personsAndTeams: [{ id: 'uid-9', kind: 'person' }] },
        {
          personNames: names,
        },
      ).ok,
    ).toBe(false);
  });

  it('does not convert to or from anything else', () => {
    const names = { 'uid-1': 'Avery Quinn' };
    expect(convertValue(people, 'status', statusSettings, value, { personNames: names }).ok).toBe(
      false,
    );
    expect(
      convertValue(people, 'dropdown', dropdownSettings, value, { personNames: names }).ok,
    ).toBe(false);
    expect(convertValue(col('text'), 'people', defaults('people'), 'Avery Quinn').ok).toBe(false);
  });
});

describe('derived, server-managed and opaque types', () => {
  it('a derived target stores nothing, so every value is dropped', () => {
    const plan = planColumnConversion(col('text'), 'formula', defaults('formula'), [
      { id: 'a', value: 'x' },
      { id: 'b', value: 'y' },
    ]);
    expect(plan).toMatchObject({ converted: 0, cleared: 2 });
  });

  it('a server-managed target converts nothing', () => {
    expect(convertValue(col('text'), 'files', defaults('files'), 'x').ok).toBe(false);
  });

  it('id-only sources convert to nothing', () => {
    expect(convertValue(col('dependency'), 'text', {}, { item_ids: ['abc'] }).ok).toBe(false);
    expect(
      convertValue(
        col('board_relation'),
        'text',
        {},
        { linkedItems: [{ boardId: 'b1', itemId: 'i1' }] },
      ).ok,
    ).toBe(false);
  });

  it('a server-managed source can become text (its display text)', () => {
    expect(
      ok(convertValue(col('time_tracking'), 'text', {}, { duration: 0, running: false })),
    ).toEqual(expect.any(String));
  });

  it('rejects a value that is not valid for the old type', () => {
    expect(convertValue(col('numbers'), 'text', {}, { not: 'a number' }).ok).toBe(false);
  });
});

describe('rating and colour', () => {
  it('numbers -> rating keeps integers within the limit', () => {
    const numbers = col('numbers');
    expect(ok(convertValue(numbers, 'rating', { limit: 5, symbol: 'stars' }, 3))).toEqual({
      rating: 3,
    });
    expect(convertValue(numbers, 'rating', { limit: 5, symbol: 'stars' }, 7).ok).toBe(false);
    expect(convertValue(numbers, 'rating', { limit: 5, symbol: 'stars' }, 2.5).ok).toBe(false);
  });

  it('text -> colour needs a hex code', () => {
    expect(ok(convertValue(col('text'), 'color_picker', {}, '#ff5733'))).toEqual({
      color: { hex: '#ff5733' },
    });
    expect(convertValue(col('text'), 'color_picker', {}, 'red').ok).toBe(false);
  });
});

describe('planColumnConversion and samples', () => {
  it('counts converted and cleared values and gives sample conversions', () => {
    const entries = [
      { id: 'a', value: '10' },
      { id: 'b', value: 'ten' },
      { id: 'c', value: '$30' },
      { id: 'd', value: '40' },
    ];
    const plan = planColumnConversion(col('text'), 'numbers', defaults('numbers'), entries);
    expect(plan).toMatchObject({ converted: 3, cleared: 1 });
    expect(conversionSamples(col('text'), 'numbers', plan, entries)).toEqual([
      { before: '10', after: '10' },
      { before: 'ten', after: null },
      { before: '$30', after: '30' },
    ]);
  });
});

describe('columnTypeChangeSupport', () => {
  it('lists what is refused, owner-only and cleared', () => {
    expect(columnTypeChangeSupport('text', 'text').allowed).toBe(false);
    expect(columnTypeChangeSupport('text', 'files').allowed).toBe(false);
    expect(columnTypeChangeSupport('text', 'nonsense').allowed).toBe(false);
    expect(columnTypeChangeSupport('text', 'numbers')).toEqual({ allowed: true });
    expect(columnTypeChangeSupport('text', 'formula')).toMatchObject({
      allowed: true,
      warning: 'Values will be cleared',
    });
    expect(columnTypeChangeSupport('people', 'status').warning).toBeTruthy();
    expect(columnTypeChangeSupport('people', 'text').warning).toBeUndefined();
    expect(columnTypeChangeSupport('files', 'text')).toEqual({ allowed: true, ownerOnly: true });
    expect(columnTypeChangeSupport('formula', 'text')).toEqual({ allowed: true, ownerOnly: true });
    expect(columnTypeChangeSupport('files', 'status').allowed).toBe(false);
    expect(columnTypeChangeSupport('button', 'numbers').allowed).toBe(false);
  });

  it('derived and server-managed sources get the targets that can hold what they show', () => {
    for (const to of ['numbers', 'date', 'status', 'checkbox', 'location', 'long_text']) {
      expect(columnTypeChangeSupport('formula', to)).toEqual({ allowed: true, ownerOnly: true });
    }
    expect(columnTypeChangeSupport('time_tracking', 'numbers').allowed).toBe(true);
    expect(columnTypeChangeSupport('time_tracking', 'date').allowed).toBe(false);
    expect(columnTypeChangeSupport('creation_log', 'date').allowed).toBe(true);
    expect(columnTypeChangeSupport('last_updated', 'date').allowed).toBe(true);
    expect(columnTypeChangeSupport('files', 'long_text').allowed).toBe(true);
    // Never into a derived or server-managed type, nor between two of them.
    for (const from of ['formula', 'mirror', 'progress', 'files', 'time_tracking', 'button']) {
      for (const to of ['formula', 'progress', 'mirror', 'files', 'button', 'time_tracking']) {
        if (from !== to) expect(columnTypeChangeSupport(from, to).allowed).toBe(false);
      }
    }
  });

  it('newer writable types offer every parsed target', () => {
    for (const from of ['location', 'country', 'hour', 'week', 'world_clock', 'vote']) {
      expect(columnTypeChangeSupport(from, 'text')).toEqual({ allowed: true });
      expect(columnTypeChangeSupport(from, 'long_text')).toEqual({ allowed: true });
    }
    for (const to of ['location', 'country', 'hour', 'world_clock']) {
      expect(columnTypeChangeSupport('text', to)).toEqual({ allowed: true });
    }
    expect(columnTypeChangeSupport('dependency', 'text').warning).toBeTruthy();
  });
});

describe('newer types', () => {
  it('location <-> text', () => {
    expect(
      ok(convertValue(col('location'), 'text', {}, { lat: 1, lng: 2, address: 'Main St' })),
    ).toBe('Main St');
    expect(ok(convertValue(col('location'), 'long_text', {}, { lat: 1.5, lng: -2 }))).toEqual({
      text: '1.5, -2',
    });
    expect(ok(convertValue(col('text'), 'location', {}, '40.7, -74.0'))).toEqual({
      lat: 40.7,
      lng: -74,
    });
    expect(convertValue(col('text'), 'location', {}, '95, 10').ok).toBe(false);
    expect(convertValue(col('text'), 'location', {}, 'Main St').ok).toBe(false);
    // Round trip through text keeps the point when there is no address.
    const text = ok(convertValue(col('location'), 'text', {}, { lat: 12.5, lng: 99 })) as string;
    expect(ok(convertValue(col('text'), 'location', {}, text))).toEqual({ lat: 12.5, lng: 99 });
  });

  it('country, hour and world clock from text', () => {
    expect(ok(convertValue(col('text'), 'country', {}, 'fr'))).toMatchObject({ countryCode: 'FR' });
    expect(ok(convertValue(col('text'), 'country', {}, 'Japan'))).toMatchObject({
      countryCode: 'JP',
    });
    expect(convertValue(col('text'), 'country', {}, 'Atlantis').ok).toBe(false);
    expect(ok(convertValue(col('text'), 'hour', {}, '2:30 PM'))).toEqual({ hour: 14, minute: 30 });
    expect(convertValue(col('text'), 'hour', {}, 'noon').ok).toBe(false);
    expect(ok(convertValue(col('text'), 'world_clock', {}, 'Europe/Paris'))).toEqual({
      timezone: 'Europe/Paris',
    });
    const clock = ok(
      convertValue(col('world_clock'), 'text', {}, { timezone: 'Europe/Paris' }),
    ) as string;
    expect(ok(convertValue(col('text'), 'world_clock', {}, clock))).toEqual({
      timezone: 'Europe/Paris',
    });
    expect(convertValue(col('text'), 'world_clock', {}, 'Mars/Base').ok).toBe(false);
  });

  it('vote, week and hour convert to text and numbers', () => {
    expect(ok(convertValue(col('vote'), 'numbers', {}, { votersIds: ['a', 'b'] }))).toBe(2);
    expect(ok(convertValue(col('hour'), 'text', {}, { hour: 9, minute: 5 }))).toBe('09:05');
  });

  it('formula, progress and mirror results become numbers, dates and labels', () => {
    expect(ok(convertValue(col('progress'), 'numbers', {}, { progress: 40 }))).toBe(40);
    expect(ok(convertValue(col('auto_number'), 'numbers', {}, { auto_number: 7 }))).toBe(7);
    expect(ok(convertValue(col('formula'), 'numbers', {}, '12.5'))).toBe(12.5);
    expect(ok(convertValue(col('formula'), 'date', {}, '2026-03-04'))).toEqual({
      date: '2026-03-04',
    });
    expect(ok(convertValue(col('formula'), 'status', defaults('status'), 'Done'))).toEqual(
      expect.objectContaining({ index: expect.any(Number) }),
    );
    expect(convertValue(col('formula'), 'numbers', {}, 'abc').ok).toBe(false);
  });

  it('time tracking -> numbers is the total in seconds; files and button stay text', () => {
    const value = {
      duration: 5400,
      running: false,
      history: [{ id: 's1', startedAt: 1000, endedAt: 5401000, duration: 5400, userId: 'u1' }],
    };
    expect(ok(convertValue(col('time_tracking'), 'numbers', {}, value))).toBe(5400);
    expect(columnTypeChangeSupport('button', 'numbers').allowed).toBe(false);
    expect(columnTypeChangeSupport('files', 'numbers').allowed).toBe(false);
  });

  it('creation log and last updated -> date take the UTC day', () => {
    expect(
      ok(convertValue(col('creation_log'), 'date', {}, { created_at: '2026-03-04T23:30:00.000Z' })),
    ).toEqual({ date: '2026-03-04' });
    expect(
      ok(convertValue(col('last_updated'), 'date', {}, { updated_at: '2026-05-06T01:00:00.000Z' })),
    ).toEqual({ date: '2026-05-06' });
  });

  it('reports converted and cleared counts for a mixed column', () => {
    const plan = planColumnConversion(col('text'), 'location', {}, [
      { id: 'a', value: '1, 2' },
      { id: 'b', value: 'somewhere' },
      { id: 'c', value: '-33.9, 151.2' },
    ]);
    expect(plan).toMatchObject({ converted: 2, cleared: 1 });
  });
});

describe('findColumnDependents', () => {
  const def = (
    id: string,
    type: string,
    settings: Record<string, unknown>,
    title = id,
  ): ColumnDef => ({
    id,
    type,
    title,
    position: 'a0',
    settings,
  });

  it('finds formulas, progress, mirrors, dependencies and views that use a column', () => {
    const columns = [
      def('num', 'numbers', {}),
      def('total', 'formula', { expression: '{num} * 2', outputType: 'number' }, 'Total'),
      def('other', 'formula', { expression: '1 + 1', outputType: 'number' }),
      def(
        'prog',
        'progress',
        {
          related_columns: {
            isNormalized: true,
            columns: { num: { isSelected: true, percentage: 100 } },
          },
        },
        'Progress',
      ),
      def('mir', 'mirror', { relationColumnId: 'num', targetColumnIds: {} }, 'Mirror'),
      def('dep', 'dependency', { timeColumnId: 'num', strict: false }, 'Depends'),
    ];
    const view = {
      name: 'Board view',
      settings: {
        filter: {
          personIds: [],
          filterGroup: { conjunction: 'and' as const, conditions: [] },
          sortConditions: [],
          groupByColumnId: null,
        },
        hiddenColumnIds: [],
        kanban: {
          columnId: 'num',
          cardColumnIds: null,
          collapsedLaneIds: [],
          showEmptyLanes: true,
        },
      },
    };
    expect(findColumnDependents(columns, 'num', [view])).toEqual([
      { kind: 'formula', title: 'Total' },
      { kind: 'progress', title: 'Progress' },
      { kind: 'mirror', title: 'Mirror' },
      { kind: 'dependency', title: 'Depends' },
      { kind: 'view', title: 'Board view' },
    ]);
    expect(findColumnDependents(columns, 'total')).toEqual([]);
  });
});
