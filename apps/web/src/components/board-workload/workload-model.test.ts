import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { columnRegistry, type ColumnDef } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../../test/fixtures';
import { buildColumnViews } from '../board-table/table-model';
import { textContrastFor } from '../board-date-views/date-view-model';
import {
  DEFAULT_CAPACITY,
  UNASSIGNED_ID,
  amountOf,
  buildWorkload,
  formatAmount,
  levelFor,
  personsOf,
  resolveWorkloadColumns,
  type BuildWorkloadInput,
  type WorkloadModel,
  type WorkloadRow,
} from './workload-model';

const column = (id: string, type: string, title: string, position: string): ColumnDef => ({
  id,
  type,
  title,
  position,
  settings: columnRegistry.defaultSettings(type) as Record<string, unknown>,
});

const columns = buildColumnViews([
  column('who', 'people', 'Owner', 'a0'),
  column('est', 'numbers', 'Estimate', 'a1'),
  column('due', 'date', 'Due', 'a2'),
  column('plan', 'timeline', 'Plan', 'a3'),
]);
const plan = columns.find((c) => c.def.id === 'plan')!;
const due = columns.find((c) => c.def.id === 'due')!;
const who = columns.find((c) => c.def.id === 'who')!;
const est = columns.find((c) => c.def.id === 'est')!;

// Saturday 24 October 2026: Monday 26 to Friday 30 is a working week.
const TODAY = '2026-10-24';

const NAMES: Record<string, string> = { u1: 'Zoe Quinn', u2: 'Avery Quinn', u3: 'Mika Lane' };

const people = (...ids: string[]) => ({
  personsAndTeams: ids.map((id) => ({ id, kind: id.startsWith('t') ? 'team' : 'person' })),
});

const item = (
  id: string,
  from: string | null,
  to: string | null,
  assignees: string[] = [],
  extra: Record<string, unknown> = {},
) =>
  makeItem({
    id,
    name: `Item ${id}`,
    values: {
      ...(from && to ? { plan: { from, to } } : {}),
      ...(assignees.length ? { who: people(...assignees) } : {}),
      ...extra,
    },
  });

function build(overrides: Partial<BuildWorkloadInput> = {}): WorkloadModel {
  return buildWorkload({
    items: [],
    columns,
    dateColumn: plan,
    peopleColumn: who,
    sumColumn: est,
    search: '',
    settings: { zoom: 'days', measure: 'count', capacityPerDay: null, showWeekends: true },
    today: TODAY,
    nameOf: (id) => NAMES[id],
    ...overrides,
  });
}

const rowOf = (model: WorkloadModel, id: string): WorkloadRow =>
  model.rows.find((r) => r.id === id)!;

/** The cell of a day at the days zoom. */
const dayCell = (model: WorkloadModel, row: WorkloadRow, day: string) =>
  row.cells[model.axis.lowerBound(day)]!;

describe('levelFor', () => {
  it('is empty without work, under below 60%, balanced up to 100%, over above', () => {
    expect(levelFor(0, 8)).toBe('empty');
    expect(levelFor(4.7, 8)).toBe('under');
    expect(levelFor(4.8, 8)).toBe('balanced'); // exactly 60%
    expect(levelFor(8, 8)).toBe('balanced'); // exactly 100%
    expect(levelFor(8.1, 8)).toBe('over');
    expect(levelFor(0.6, 1)).toBe('balanced');
    expect(levelFor(1, 1)).toBe('balanced');
    expect(levelFor(2, 1)).toBe('over');
  });

  it('treats any work against no capacity as over', () => {
    expect(levelFor(1, 0)).toBe('over');
  });
});

describe('helpers', () => {
  it('formats amounts with up to one decimal', () => {
    expect(formatAmount(3)).toBe('3');
    expect(formatAmount(2.5)).toBe('2.5');
    expect(formatAmount(2.04)).toBe('2');
    expect(formatAmount(0.1 + 0.2)).toBe('0.3');
  });

  it('reads persons, skipping teams and repeats', () => {
    const it1 = item('a', null, null, ['u1', 't1', 'u1', 'u2']);
    expect(personsOf(it1, who)).toEqual(['u1', 'u2']);
    expect(personsOf(item('b', null, null), who)).toEqual([]);
    expect(personsOf(it1, null)).toEqual([]);
  });

  it('reads numbers, treating missing, invalid and negative as 0', () => {
    expect(amountOf(item('a', null, null, [], { est: '12.5' }), est)).toBe(12.5);
    expect(amountOf(item('a', null, null, [], { est: 7 }), est)).toBe(7);
    expect(amountOf(item('a', null, null, [], { est: 'abc' }), est)).toBe(0);
    expect(amountOf(item('a', null, null, [], { est: -3 }), est)).toBe(0);
    expect(amountOf(item('a', null, null), est)).toBe(0);
    expect(amountOf(item('a', null, null, [], { est: 5 }), null)).toBe(0);
  });

  it('resolves the saved columns, else the first of each kind', () => {
    const resolved = resolveWorkloadColumns(columns, {
      columnId: 'due',
      peopleColumnId: 'gone',
      sumColumnId: null,
    });
    expect(resolved.dateColumn?.def.id).toBe('due');
    expect(resolved.peopleColumn?.def.id).toBe('who');
    expect(resolved.sumColumn?.def.id).toBe('est');
    const none = resolveWorkloadColumns([], {
      columnId: null,
      peopleColumnId: null,
      sumColumnId: null,
    });
    expect(none).toEqual({ dateColumn: null, peopleColumn: null, sumColumn: null });
  });
});

describe('buildWorkload: rows', () => {
  it('has one row per person in alphabetical order, with Unassigned last', () => {
    const model = build({
      items: [
        item('a', '2026-10-26', '2026-10-26', ['u1']),
        item('b', '2026-10-26', '2026-10-26', ['u2']),
        item('c', '2026-10-26', '2026-10-26'),
        item('d', '2026-10-26', '2026-10-26', ['u3']),
      ],
    });
    expect(model.rows.map((r) => r.name)).toEqual([
      'Avery Quinn',
      'Mika Lane',
      'Zoe Quinn',
      'Unassigned',
    ]);
    expect(model.rows[3]!.id).toBe(UNASSIGNED_ID);
  });

  it('shows no Unassigned row when everything is assigned', () => {
    const model = build({ items: [item('a', '2026-10-26', '2026-10-26', ['u1'])] });
    expect(model.rows.map((r) => r.id)).toEqual(['u1']);
  });

  it('falls back to the id for an unknown person', () => {
    const model = build({ items: [item('a', '2026-10-26', '2026-10-26', ['u9'])] });
    expect(model.rows[0]!.name).toBe('u9');
  });

  it('skips teams: a team-only item is unassigned, and a mixed one counts for its persons', () => {
    const model = build({
      items: [
        item('a', '2026-10-26', '2026-10-26', ['t1']),
        item('b', '2026-10-26', '2026-10-26', ['t1', 'u1']),
      ],
    });
    expect(model.rows.map((r) => r.id)).toEqual(['u1', UNASSIGNED_ID]);
    expect(dayCell(model, rowOf(model, UNASSIGNED_ID), '2026-10-26').entries).toHaveLength(1);
    expect(dayCell(model, rowOf(model, 'u1'), '2026-10-26').entries).toHaveLength(1);
  });

  it('keeps a person whose items have no dates, with empty cells', () => {
    const model = build({
      items: [item('a', null, null, ['u1']), item('b', '2026-10-26', '2026-10-26', ['u2'])],
    });
    const row = rowOf(model, 'u1');
    expect(row.total).toBe(0);
    expect(row.cells.every((c) => c.level === 'empty')).toBe(true);
  });

  it('lists items without dates and flags a view with none dated', () => {
    const model = build({ items: [item('a', null, null, ['u1'])] });
    expect(model.noDates.map((i) => i.id)).toEqual(['a']);
    expect(model.noItemsDated).toBe(true);
    expect(build({ items: [item('b', '2026-10-26', '2026-10-26', ['u1'])] }).noItemsDated).toBe(
      false,
    );
  });

  it('ignores subitems and honours the search', () => {
    const sub = makeItem({
      id: 'sub',
      parentItemId: 'a',
      values: { plan: { from: '2026-10-26', to: '2026-10-26' }, who: people('u1') },
    });
    const model = build({
      items: [
        item('a', '2026-10-26', '2026-10-26', ['u1']),
        sub,
        item('z', '2026-10-26', '2026-10-26', ['u2']),
      ],
      search: 'Item a',
    });
    expect(model.rows.map((r) => r.id)).toEqual(['u1']);
    expect(dayCell(model, rowOf(model, 'u1'), '2026-10-26').value).toBe(1);
  });

  it('places items by a date column too', () => {
    const model = build({
      dateColumn: due,
      items: [makeItem({ id: 'a', values: { due: { date: '2026-10-27' }, who: people('u1') } })],
    });
    expect(dayCell(model, rowOf(model, 'u1'), '2026-10-27').value).toBe(1);
    expect(dayCell(model, rowOf(model, 'u1'), '2026-10-26').value).toBe(0);
  });
});

describe('buildWorkload: count', () => {
  it('counts an item once in each day it covers, fully for each assignee', () => {
    const model = build({ items: [item('a', '2026-10-26', '2026-10-28', ['u1', 'u2'])] });
    for (const id of ['u1', 'u2']) {
      const row = rowOf(model, id);
      expect(dayCell(model, row, '2026-10-25').value).toBe(0);
      for (const day of ['2026-10-26', '2026-10-27', '2026-10-28']) {
        expect(dayCell(model, row, day).value).toBe(1);
      }
      expect(dayCell(model, row, '2026-10-29').value).toBe(0);
      expect(row.total).toBe(3);
      expect(row.itemCount).toBe(1);
    }
  });

  it('adds overlapping items and flags the person over capacity', () => {
    const model = build({
      items: [
        item('a', '2026-10-26', '2026-10-27', ['u1']),
        item('b', '2026-10-27', '2026-10-27', ['u1']),
      ],
    });
    const row = rowOf(model, 'u1');
    expect(dayCell(model, row, '2026-10-26').level).toBe('balanced');
    expect(dayCell(model, row, '2026-10-27').value).toBe(2);
    expect(dayCell(model, row, '2026-10-27').level).toBe('over');
    expect(row.overCapacity).toBe(true);
    expect(dayCell(model, row, '2026-10-27').entries.map((e) => e.item.id)).toEqual(['a', 'b']);
  });

  it('uses the capacity setting', () => {
    const model = build({
      items: [
        item('a', '2026-10-26', '2026-10-26', ['u1']),
        item('b', '2026-10-26', '2026-10-26', ['u1']),
      ],
      settings: { zoom: 'days', measure: 'count', capacityPerDay: 4, showWeekends: true },
    });
    const cell = dayCell(model, rowOf(model, 'u1'), '2026-10-26');
    expect(cell.capacity).toBe(4);
    expect(cell.level).toBe('under'); // 2 of 4 = 50%
    expect(model.capacityPerDay).toBe(4);
  });
});

describe('buildWorkload: sum', () => {
  const sum = {
    zoom: 'days' as const,
    measure: 'sum' as const,
    capacityPerDay: null,
    showWeekends: true,
  };

  it('spreads a 40 h item over five working days, 8 h a day', () => {
    const model = build({
      items: [item('a', '2026-10-26', '2026-10-30', ['u1'], { est: 40 })],
      settings: sum,
    });
    const row = rowOf(model, 'u1');
    for (const day of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) {
      expect(dayCell(model, row, day).value).toBe(8);
      expect(dayCell(model, row, day).level).toBe('balanced');
    }
    expect(row.total).toBe(40);
    expect(model.capacityPerDay).toBe(DEFAULT_CAPACITY.sum);
  });

  it('spreads over every day when weekends show', () => {
    const model = build({
      items: [item('a', '2026-10-24', '2026-10-27', ['u1'], { est: 40 })],
      settings: sum,
    });
    const row = rowOf(model, 'u1');
    expect(dayCell(model, row, '2026-10-24').value).toBe(10);
    expect(dayCell(model, row, '2026-10-25').value).toBe(10);
    expect(dayCell(model, row, '2026-10-27').value).toBe(10);
  });

  it('skips weekends when they are hidden, leaving the weekdays more', () => {
    const model = build({
      items: [item('a', '2026-10-24', '2026-10-27', ['u1'], { est: 40 })],
      settings: { ...sum, showWeekends: false },
    });
    const row = rowOf(model, 'u1');
    expect(model.axis.days).not.toContain('2026-10-24');
    expect(dayCell(model, row, '2026-10-26').value).toBe(20);
    expect(dayCell(model, row, '2026-10-27').value).toBe(20);
    expect(dayCell(model, row, '2026-10-26').level).toBe('over');
    expect(row.total).toBe(40);
  });

  it('counts a multi-assignee item fully for each, and an item without a number as 0', () => {
    const model = build({
      items: [
        item('a', '2026-10-26', '2026-10-26', ['u1', 'u2'], { est: 6 }),
        item('b', '2026-10-26', '2026-10-26', ['u1']),
      ],
      settings: sum,
    });
    expect(dayCell(model, rowOf(model, 'u1'), '2026-10-26').value).toBe(6);
    expect(dayCell(model, rowOf(model, 'u2'), '2026-10-26').value).toBe(6);
    // The unnumbered item is still listed in the cell, with 0.
    const entries = dayCell(model, rowOf(model, 'u1'), '2026-10-26').entries;
    expect(entries.map((e) => [e.item.id, e.amount])).toEqual([
      ['a', 6],
      ['b', 0],
    ]);
  });

  it('falls back to count when the board has no Numbers column', () => {
    const model = build({
      sumColumn: null,
      items: [item('a', '2026-10-26', '2026-10-26', ['u1'])],
      settings: sum,
    });
    expect(model.measure).toBe('count');
    expect(dayCell(model, rowOf(model, 'u1'), '2026-10-26').value).toBe(1);
    expect(model.capacityPerDay).toBe(DEFAULT_CAPACITY.count);
  });
});

describe('buildWorkload: weeks and months', () => {
  it('adds up a week of 8 h days against five working days of capacity when weekends are hidden', () => {
    const model = build({
      items: [item('a', '2026-10-26', '2026-10-30', ['u1'], { est: 40 })],
      settings: { zoom: 'weeks', measure: 'sum', capacityPerDay: null, showWeekends: false },
    });
    const week = rowOf(model, 'u1').cells.find((c) => c.value > 0)!;
    expect(week.value).toBe(40);
    expect(week.capacity).toBe(40);
    expect(week.level).toBe('balanced');
    expect(week.span).toBe(7);
  });

  it('counts weekend days in the capacity when weekends show', () => {
    const model = build({
      items: [item('a', '2026-10-26', '2026-10-30', ['u1'])],
      settings: { zoom: 'weeks', measure: 'count', capacityPerDay: null, showWeekends: true },
    });
    const week = rowOf(model, 'u1').cells.find((c) => c.value > 0)!;
    expect(week.value).toBe(5); // item-days
    expect(week.capacity).toBe(7);
    expect(week.level).toBe('balanced');
  });

  it('splits an item across the weeks it covers', () => {
    const model = build({
      items: [item('a', '2026-10-29', '2026-11-03', ['u1'], { est: 24 })],
      settings: { zoom: 'weeks', measure: 'sum', capacityPerDay: null, showWeekends: false },
    });
    const values = rowOf(model, 'u1')
      .cells.filter((c) => c.value > 0)
      .map((c) => c.value);
    // Thu, Fri | Mon, Tue = 4 working days at 6 h.
    expect(values).toEqual([12, 12]);
  });

  it('aggregates a month and keeps the entries of the items in it', () => {
    const model = build({
      items: [
        item('a', '2026-10-26', '2026-10-27', ['u1']),
        item('b', '2026-11-02', '2026-11-02', ['u1']),
      ],
      settings: { zoom: 'months', measure: 'count', capacityPerDay: null, showWeekends: true },
    });
    const cells = rowOf(model, 'u1').cells.filter((c) => c.value > 0);
    expect(cells.map((c) => [c.value, c.entries.map((e) => e.item.id)])).toEqual([
      [2, ['a']],
      [1, ['b']],
    ]);
    expect(cells[0]!.level).toBe('under'); // 2 of 31 days
  });

  it('marks the cell holding today and weekend day cells', () => {
    const model = build({ items: [item('a', '2026-10-26', '2026-10-26', ['u1'])] });
    const row = rowOf(model, 'u1');
    expect(dayCell(model, row, TODAY).today).toBe(true);
    expect(dayCell(model, row, TODAY).weekend).toBe(true);
    expect(dayCell(model, row, '2026-10-26').today).toBe(false);
    expect(dayCell(model, row, '2026-10-26').weekend).toBe(false);
    expect(model.axis.days[model.todayIdx]).toBe(TODAY);
  });
});

describe('workload tint tokens', () => {
  const tokensCss = readFileSync(resolve(process.cwd(), 'src/theme/workload-tokens.css'), 'utf8');
  /** The hex value of a custom property inside the CSS block that starts at `selector`. */
  const tint = (selector: string, name: string): string => {
    const block = tokensCss.slice(tokensCss.indexOf(selector));
    const match = new RegExp(`--atrium-workload-${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(block);
    if (!match) throw new Error(`token ${name} not found after ${selector}`);
    return match[1]!;
  };

  it.each(['under', 'balanced', 'over'])(
    'keeps the %s tint readable: dark ink in light themes, white in dark ones (WCAG AA)',
    (level) => {
      const light = textContrastFor(tint(':root', level))!;
      expect(light.dark).toBeGreaterThanOrEqual(4.5);
      const dark = textContrastFor(tint('.dark-app-theme', level))!;
      expect(dark.light).toBeGreaterThanOrEqual(4.5);
    },
  );
});
