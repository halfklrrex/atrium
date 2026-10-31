import type { ColumnDef } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { makeBoard, makeItem } from '../../test/fixtures';
import {
  bucketOf,
  buildRows,
  buildSections,
  rowMatchesSearch,
  type AssignedEntry,
} from './my-work-model';

const column = (id: string, type: string, position: string, settings: object = {}): ColumnDef =>
  ({ id, type, title: id, position, settings }) as ColumnDef;

const STATUS = {
  labels: [
    { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
    { id: 'work', index: 0, label: 'Working', color: '#fdab3d' },
  ],
};

const board = makeBoard({
  id: 'b1',
  name: 'Roadmap',
  workspaceId: 'w1',
  groups: [{ id: 'g1', title: 'Launch', color: '#579bfc', position: 'a0' }],
  columns: [
    column('person', 'people', 'a0'),
    column('status', 'status', 'a1', STATUS),
    column('due', 'date', 'a2'),
    column('span', 'timeline', 'a3'),
  ],
});

const entry = (id: string, values: Record<string, unknown>, name = id): AssignedEntry => ({
  board,
  item: makeItem({ id, name, groupId: 'g1', values }),
});

const rowsOf = (entries: AssignedEntry[]) => buildRows(entries, new Map([['w1', 'Home']]));
const dueRow = (date: string | null, done = false) => ({ date, done });

describe('bucketOf', () => {
  // 2026-10-28 is a Wednesday: this week (Monday start) ends Sunday 11-01, next week 11-08.
  const today = '2026-10-28';

  it('splits dates around today, this week, next week and later', () => {
    expect(bucketOf(dueRow('2026-10-27'), today)).toBe('past');
    expect(bucketOf(dueRow('2026-10-28'), today)).toBe('today');
    expect(bucketOf(dueRow('2026-10-29'), today)).toBe('thisWeek');
    expect(bucketOf(dueRow('2026-11-01'), today)).toBe('thisWeek');
    expect(bucketOf(dueRow('2026-11-02'), today)).toBe('nextWeek');
    expect(bucketOf(dueRow('2026-11-08'), today)).toBe('nextWeek');
    expect(bucketOf(dueRow('2026-11-09'), today)).toBe('later');
    expect(bucketOf(dueRow(null), today)).toBe('none');
  });

  it('puts done rows in Done whatever their date', () => {
    expect(bucketOf(dueRow('2026-10-01', true), today)).toBe('done');
    expect(bucketOf(dueRow(null, true), today)).toBe('done');
  });

  it('handles the week boundary on a Sunday and with a Sunday week start', () => {
    // Sunday 2026-11-01 is the last day of the week with Monday weeks.
    expect(bucketOf(dueRow('2026-11-01'), '2026-11-01')).toBe('today');
    expect(bucketOf(dueRow('2026-11-02'), '2026-11-01')).toBe('nextWeek');
    expect(bucketOf(dueRow('2026-11-01'), '2026-10-28', 'sunday')).toBe('nextWeek');
    expect(bucketOf(dueRow('2026-10-31'), '2026-10-28', 'sunday')).toBe('thisWeek');
  });

  it('crosses a month and year boundary', () => {
    expect(bucketOf(dueRow('2027-01-02'), '2026-12-31')).toBe('thisWeek');
    expect(bucketOf(dueRow('2027-01-05'), '2026-12-31')).toBe('nextWeek');
  });
});

describe('buildRows', () => {
  it('uses the first date column with a value and falls back to the timeline end', () => {
    const [withDate, withTimeline, bare] = rowsOf([
      entry('a', { due: { date: '2026-11-03' }, span: { from: '2026-10-01', to: '2026-10-05' } }),
      entry('b', { span: { from: '2026-10-01', to: '2026-10-05' } }),
      entry('c', {}),
    ]);
    expect(withDate?.date).toBe('2026-11-03');
    expect(withDate?.dateColumn?.def.id).toBe('due');
    expect(withTimeline?.date).toBe('2026-10-05');
    expect(withTimeline?.dateColumn?.def.id).toBe('span');
    expect(bare?.date).toBeNull();
    expect(bare?.workspaceName).toBe('Home');
    expect(bare?.group?.title).toBe('Launch');
  });

  it('marks rows done from the first status column', () => {
    const [done, working] = rowsOf([
      entry('a', { status: { index: 1 } }),
      entry('b', { status: { index: 0 } }),
    ]);
    expect(done?.done).toBe(true);
    expect(working?.done).toBe(false);
  });

  it('uses the subitem columns for subitems', () => {
    const sub = makeBoard({
      id: 'b2',
      workspaceId: 'w1',
      subitemColumns: [column('sub_date', 'date', 'a0')],
    });
    const [row] = buildRows(
      [
        {
          board: sub,
          item: makeItem({
            id: 's1',
            parentItemId: 'p1',
            values: { sub_date: { date: '2026-11-04' } },
          }),
        },
      ],
      new Map(),
    );
    expect(row?.date).toBe('2026-11-04');
  });
});

describe('buildSections', () => {
  const today = '2026-10-28';
  const rows = rowsOf([
    entry('late', { due: { date: '2026-10-20' } }, 'Late fix'),
    entry('now', { due: { date: '2026-10-28' } }, 'Ship it'),
    entry('later-b', { due: { date: '2026-12-01' } }, 'Plan Q1'),
    entry('later-a', { due: { date: '2026-11-20' } }, 'Plan Q4'),
    entry('nodate', {}, 'Someday'),
    entry('fin', { status: { index: 1 }, due: { date: '2026-10-01' } }, 'Finished'),
  ]);

  it('returns the non-empty sections in order, rows sorted by date', () => {
    const sections = buildSections(rows, today, '');
    expect(sections.map((s) => s.id)).toEqual(['past', 'today', 'later', 'none', 'done']);
    expect(sections.find((s) => s.id === 'later')?.rows.map((r) => r.item.id)).toEqual([
      'later-a',
      'later-b',
    ]);
  });

  it('filters by item, board and group, ignoring case', () => {
    expect(buildSections(rows, today, 'SHIP').flatMap((s) => s.rows)).toHaveLength(1);
    expect(buildSections(rows, today, 'roadmap').flatMap((s) => s.rows)).toHaveLength(6);
    expect(buildSections(rows, today, 'launch').flatMap((s) => s.rows)).toHaveLength(6);
    expect(buildSections(rows, today, 'nothing here')).toEqual([]);
    expect(rowMatchesSearch(rows[0]!, '  ')).toBe(true);
  });
});
