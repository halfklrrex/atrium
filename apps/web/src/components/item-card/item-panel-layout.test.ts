import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '@atrium/shared';
import { buildColumnViews, type ColumnView } from '../board-table/table-model';
import type { ItemDoc } from '../../data';
import {
  DESCRIPTION_FULL_LINES,
  GRID_FIELD_CAP,
  descriptionMode,
  isWideFieldType,
  keyBarEmptyHint,
  partitionGridFields,
  selectKeyBarColumns,
  subitemSummary,
} from './item-panel-layout';

const views = (specs: [string, string][]): ColumnView[] =>
  buildColumnViews(
    specs.map(
      ([id, type], i) =>
        ({
          id,
          type,
          title: id,
          position: `a${String(i).padStart(2, '0')}`,
          settings: {},
        }) as ColumnDef,
    ),
  );

const slots = (cols: ColumnView[]) =>
  selectKeyBarColumns(cols).map((s) => `${s.slot}:${s.column.def.id}`);

describe('selectKeyBarColumns', () => {
  it('fills all four slots', () => {
    const cols = views([
      ['s1', 'status'],
      ['p', 'people'],
      ['d', 'date'],
      ['s2', 'status'],
    ]);
    expect(slots(cols)).toEqual(['status:s1', 'owner:p', 'due:d', 'priority:s2']);
  });

  it('keeps slot order whatever the board order', () => {
    const cols = views([
      ['d', 'date'],
      ['s2x', 'dropdown'],
      ['p', 'people'],
      ['s1', 'status'],
    ]);
    expect(slots(cols)).toEqual(['status:s1', 'owner:p', 'due:d', 'priority:s2x']);
  });

  it('falls back to the first timeline when there is no date', () => {
    const cols = views([
      ['t', 'timeline'],
      ['t2', 'timeline'],
    ]);
    expect(slots(cols)).toEqual(['due:t']);
  });

  it('prefers a date over a timeline', () => {
    const cols = views([
      ['t', 'timeline'],
      ['d', 'date'],
    ]);
    expect(slots(cols)).toEqual(['due:d']);
  });

  it('uses the first dropdown for priority when there is no second status', () => {
    const cols = views([
      ['s1', 'status'],
      ['dd', 'dropdown'],
    ]);
    expect(slots(cols)).toEqual(['status:s1', 'priority:dd']);
  });

  it('leaves priority to a dropdown when only one status column exists', () => {
    const cols = views([
      ['s1', 'status'],
      ['p', 'people'],
      ['dd', 'dropdown'],
    ]);
    expect(slots(cols)).toEqual(['status:s1', 'owner:p', 'priority:dd']);
  });

  it('shrinks with dropped slots and returns [] with no match', () => {
    expect(
      slots(
        views([
          ['s1', 'status'],
          ['x', 'text'],
          ['d', 'date'],
        ]),
      ),
    ).toHaveLength(2);
    expect(slots(views([['s1', 'status']]))).toHaveLength(1);
    expect(
      slots(
        views([
          ['x', 'text'],
          ['n', 'numbers'],
        ]),
      ),
    ).toEqual([]);
  });

  it('never uses a column twice', () => {
    const picked = selectKeyBarColumns(
      views([
        ['s1', 'status'],
        ['s2', 'status'],
        ['s3', 'status'],
      ]),
    );
    const ids = picked.map((s) => s.column.def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['s1', 's2']);
  });
});

describe('partitionGridFields', () => {
  const twelve = views(Array.from({ length: 12 }, (_, i) => [`c${i}`, 'text'] as [string, string]));

  it('removes key-bar ids and keeps board order', () => {
    const r = partitionGridFields(twelve, new Set(['c1']), { expanded: true });
    expect(r.total).toBe(11);
    expect(r.visible.map((c) => c.def.id)).not.toContain('c1');
    expect(r.visible[0]?.def.id).toBe('c0');
    expect(r.visible[1]?.def.id).toBe('c2');
  });

  it('caps at 10 unless expanded', () => {
    const capped = partitionGridFields(twelve, new Set(), { expanded: false });
    expect(capped.visible).toHaveLength(GRID_FIELD_CAP);
    expect(capped).toMatchObject({ total: 12, hasMore: true });
    const full = partitionGridFields(twelve, new Set(), { expanded: true });
    expect(full.visible).toHaveLength(12);
    expect(full.hasMore).toBe(true);
  });

  it('has no more at exactly the cap, and handles zero fields', () => {
    const ten = twelve.slice(0, 10);
    expect(partitionGridFields(ten, new Set(), { expanded: false })).toMatchObject({
      total: 10,
      hasMore: false,
    });
    expect(partitionGridFields([], new Set(), { expanded: false })).toEqual({
      visible: [],
      total: 0,
      hasMore: false,
    });
  });
});

describe('field helpers', () => {
  it('knows the wide types', () => {
    for (const t of ['long_text', 'link', 'files']) expect(isWideFieldType(t)).toBe(true);
    expect(isWideFieldType('text')).toBe(false);
  });

  it('has an empty hint per key-bar type', () => {
    expect(keyBarEmptyHint('status')).toBe('Set status');
    expect(keyBarEmptyHint('people')).toBe('Assign');
    expect(keyBarEmptyHint('date')).toBe('Set date');
    expect(keyBarEmptyHint('timeline')).toBe('Set dates');
    expect(keyBarEmptyHint('dropdown')).toBe('Choose');
    expect(keyBarEmptyHint('text')).toBeUndefined();
  });
});

describe('descriptionMode', () => {
  const line = 24;
  it('shows up to 12 lines in full and clamps from 13', () => {
    expect(descriptionMode(11 * line, line)).toBe('full');
    expect(descriptionMode(DESCRIPTION_FULL_LINES * line, line)).toBe('full');
    expect(descriptionMode(13 * line, line)).toBe('clamped');
  });
  it('treats a zero line height as full', () => {
    expect(descriptionMode(900, 0)).toBe('full');
  });
});

describe('subitemSummary', () => {
  const statusCols = buildColumnViews([
    {
      id: 'st',
      type: 'status',
      title: 'Status',
      position: 'a00',
      settings: {
        labels: [
          { index: 0, label: 'Todo', color: 'red' },
          { index: 1, label: 'Done', color: 'green', isDone: true },
        ],
      },
    } as unknown as ColumnDef,
  ]);
  const textCols = views([['t', 'text']]);
  const sub = (id: string, parent: string | null, index?: number) =>
    ({
      id,
      parentItemId: parent,
      values: index === undefined ? {} : { st: { index } },
    }) as unknown as ItemDoc;
  const items = [
    sub('a', 'p', 1),
    sub('b', 'p', 0),
    sub('c', 'p'),
    sub('d', 'other', 1),
    sub('e', null),
  ];

  it('counts the parent subitems and the done ones', () => {
    expect(subitemSummary(items, 'p', statusCols)).toEqual({ total: 3, done: 1 });
  });
  it('has no done count without a status column', () => {
    expect(subitemSummary(items, 'p', textCols)).toEqual({ total: 3, done: null });
  });
  it('is empty without subitems', () => {
    expect(subitemSummary(items, 'none', statusCols)).toEqual({ total: 0, done: 0 });
  });
});
