import { describe, expect, it } from 'vitest';
import type { ColumnDef } from './schemas/board';
import {
  columnsForItem,
  columnsForSubitems,
  defaultSubitemColumns,
  hasLegacySubitemColumns,
  isSubitem,
  planSubitemColumnMerge,
  subitemsByParent,
} from './subitems';

describe('defaultSubitemColumns', () => {
  it('returns Owner, Status and Date with unique ids and ordered positions', () => {
    const cols = defaultSubitemColumns();
    expect(cols.map((c) => [c.title, c.type])).toEqual([
      ['Owner', 'people'],
      ['Status', 'status'],
      ['Date', 'date'],
    ]);
    expect(new Set(cols.map((c) => c.id)).size).toBe(3);
    expect(cols.map((c) => c.position)).toEqual(['a0', 'a1', 'a2']);
    const status = cols[1]?.settings as { labels: { label: string }[] };
    expect(status.labels.map((l) => l.label)).toContain('Working on it');
  });
});

describe('default subitem column ids', () => {
  it('uses sub_* ids, which differ from the board defaults', () => {
    expect(defaultSubitemColumns().map((c) => c.id)).toEqual([
      'sub_owner',
      'sub_status',
      'sub_date',
    ]);
  });
  it('avoids ids already used by the board columns', () => {
    const ids = defaultSubitemColumns(['sub_status', 'sub_owner', 'status']).map((c) => c.id);
    expect(ids).toEqual(['sub_owner_2', 'sub_status_2', 'sub_date']);
  });
});

describe('subitem helpers', () => {
  const item = (id: string, parentItemId: string | null, position: string) => ({
    id,
    parentItemId,
    position,
  });
  it('detects subitems', () => {
    expect(isSubitem({ parentItemId: null })).toBe(false);
    expect(isSubitem({ parentItemId: 'p' })).toBe(true);
  });
  it('groups by parent sorted by position', () => {
    const map = subitemsByParent([
      item('p', null, 'a0'),
      item('s2', 'p', 'a2'),
      item('s1', 'p', 'a1'),
      item('t1', 'q', 'a0'),
    ]);
    expect(map.get('p')?.map((i) => i.id)).toEqual(['s1', 's2']);
    expect(map.get('q')?.map((i) => i.id)).toEqual(['t1']);
    expect(map.size).toBe(2);
  });
});

describe('columnsForItem', () => {
  const columns = ['c1'];
  const legacy = ['s1'];
  it('gives an item the board columns', () => {
    expect(columnsForItem({ columns, subitemColumns: legacy }, { parentItemId: null })).toBe(
      columns,
    );
    expect(columnsForItem({ columns, subitemColumns: legacy }, {})).toBe(columns);
  });
  it('gives a subitem the board columns once the board has no subitem columns', () => {
    expect(columnsForItem({ columns, subitemColumns: [] }, { parentItemId: 'p' })).toBe(columns);
    expect(columnsForItem({ columns }, { parentItemId: 'p' })).toBe(columns);
    expect(columnsForItem({ columns, subitemColumns: null }, { parentItemId: 'p' })).toBe(columns);
  });
  it('keeps the legacy subitem columns for a subitem until the board is migrated', () => {
    expect(columnsForItem({ columns, subitemColumns: legacy }, { parentItemId: 'p' })).toBe(legacy);
  });
});

describe('columnsForSubitems / hasLegacySubitemColumns', () => {
  const columns = ['c1'];
  const legacy = ['s1'];
  it('uses the board columns, or the legacy subitem columns until migrated', () => {
    expect(columnsForSubitems({ columns, subitemColumns: [] })).toBe(columns);
    expect(columnsForSubitems({ columns })).toBe(columns);
    expect(columnsForSubitems({ columns, subitemColumns: legacy })).toBe(legacy);
    expect(hasLegacySubitemColumns({ subitemColumns: legacy })).toBe(true);
    expect(hasLegacySubitemColumns({ subitemColumns: [] })).toBe(false);
    expect(hasLegacySubitemColumns({})).toBe(false);
  });
});

describe('planSubitemColumnMerge', () => {
  const status = (id: string, title: string, labels: Array<[number, string, string?]>) =>
    ({
      id,
      type: 'status',
      title,
      position: 'a0',
      settings: {
        labels: labels.map(([index, label, color]) => ({
          id: `l${index}`,
          index,
          label,
          color: color ?? '#111111',
        })),
      },
    }) as ColumnDef;
  const col = (id: string, type: string, title: string, position = 'a0'): ColumnDef => ({
    id,
    type,
    title,
    position,
    settings: {},
  });

  it('merges by type and title (case and spaces ignored) and maps status labels by text', () => {
    const board = [
      status('status', 'Status', [
        [0, 'Working on it'],
        [1, 'Done'],
      ]),
    ];
    const sub = [
      status('sub_status', ' status ', [
        [0, 'done'],
        [3, 'Blocked', '#ff0000'],
      ]),
    ];
    const plan = planSubitemColumnMerge(
      board,
      sub,
      [
        { id: 's1', values: { sub_status: { index: 0 } } },
        { id: 's2', values: { sub_status: { index: 3 } } },
        { id: 's3', values: {} },
      ],
      ['sub_status'],
    );
    expect(plan.problems).toEqual([]);
    expect(plan.decisions[0]).toMatchObject({
      action: 'merge',
      targetId: 'status',
      addedLabels: ['Blocked'],
    });
    const labels = (
      plan.columns[0]!.settings as {
        labels: Array<{ index: number; label: string; color: string }>;
      }
    ).labels;
    expect(labels.at(-1)).toMatchObject({ index: 2, label: 'Blocked', color: '#ff0000' });
    expect(plan.copies).toEqual([
      { itemId: 's1', set: { status: { index: 1 } }, remove: [] },
      { itemId: 's2', set: { status: { index: 2 } }, remove: [] },
    ]);
    expect(plan.removals.map((r) => [r.itemId, r.remove])).toEqual([
      ['s1', ['sub_status']],
      ['s2', ['sub_status']],
    ]);
    expect(plan.columnLocks).toEqual(['status']);
  });

  it('maps dropdown labels by text and copies other types unchanged', () => {
    const dd = (id: string, labels: Array<[number, string]>): ColumnDef => ({
      id,
      type: 'dropdown',
      title: 'Area',
      position: 'a0',
      settings: { labels: labels.map(([i, label]) => ({ id: i, label })), limitSelect: false },
    });
    const plan = planSubitemColumnMerge(
      [dd('area', [[0, 'Web']]), col('est', 'numbers', 'Hours')],
      [
        dd('sub_area', [
          [7, 'web'],
          [8, 'API'],
        ]),
        col('sub_est', 'numbers', 'hours'),
      ],
      [{ id: 's1', values: { sub_area: { ids: [7, 8] }, sub_est: 4 } }],
    );
    expect(plan.copies).toEqual([
      { itemId: 's1', set: { area: { ids: [0, 1] }, est: 4 }, remove: [] },
    ]);
  });

  it('moves a column that has values, with a clash-free title, and appends it after the last column', () => {
    const plan = planSubitemColumnMerge(
      [col('a', 'text', 'Notes', 'a0'), col('b', 'text', 'Other', 'a1')],
      [col('sub_note', 'text', 'Notes'), col('sub_files', 'files', 'Files')],
      [{ id: 's1', values: { sub_note: 'hi', sub_files: [{ name: 'x' }] } }],
    );
    // "Notes" has the same type and title: it merges. Files has no match: it moves.
    expect(plan.decisions.map((d) => d.action)).toEqual(['merge', 'move']);
    const moved = plan.columns.at(-1)!;
    expect(moved.id).toBe('sub_files');
    expect(moved.position > 'a1').toBe(true);

    const clash = planSubitemColumnMerge(
      [col('a', 'files', 'Files', 'a0')],
      [col('sub_files', 'files', 'Files')],
      [{ id: 's1', values: { sub_files: [{ name: 'x' }] } }],
    );
    expect(clash.decisions[0]).toMatchObject({ action: 'move', movedTitle: 'Files (subitems)' });
    expect(clash.copies).toEqual([]);
    expect(clash.removals).toEqual([]);
  });

  it('drops a column nobody filled in and removes stray empty keys', () => {
    const plan = planSubitemColumnMerge(
      [],
      [col('sub_x', 'text', 'X')],
      [
        { id: 's1', values: { sub_x: '' } },
        { id: 's2', values: {} },
      ],
      ['sub_x'],
    );
    expect(plan.decisions[0]).toMatchObject({ action: 'drop', filledCount: 0 });
    expect(plan.columns).toEqual([]);
    expect(plan.columnLocks).toEqual([]);
    expect(plan.removals).toEqual([{ itemId: 's1', set: {}, remove: ['sub_x'] }]);
  });

  it('keeps a value when the target is already filled, and reports it', () => {
    const plan = planSubitemColumnMerge(
      [col('t', 'text', 'Notes')],
      [col('sub_t', 'text', 'Notes')],
      [{ id: 's1', values: { t: 'keep', sub_t: 'old' } }],
    );
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.copies).toEqual([]);
    expect(plan.removals).toEqual([]);
  });

  it('matches each board column once, clears "required" on moved columns, and flags problems', () => {
    const plan = planSubitemColumnMerge(
      [col('t', 'text', 'Notes')],
      [col('s1', 'text', 'Notes'), { ...col('s2', 'text', 'Notes'), required: true }],
      [{ id: 'a', values: { s1: 'x', s2: 'y' } }],
    );
    expect(plan.decisions.map((d) => d.action)).toEqual(['merge', 'move']);
    expect(plan.columns.at(-1)).not.toHaveProperty('required');
    expect(plan.columns.at(-1)!.title).toBe('Notes (subitems)');

    const migrating = planSubitemColumnMerge(
      [],
      [
        {
          ...col('s', 'text', 'N'),
          migrating: { snapshotId: 'x', startedAt: 1, kind: 'change' },
        } as ColumnDef,
      ],
      [],
    );
    expect(migrating.problems).toHaveLength(1);
    const idClash = planSubitemColumnMerge(
      [col('same', 'files', 'A')],
      [col('same', 'files', 'B')],
      [{ id: 'a', values: { same: [1] } }],
    );
    expect(idClash.problems).toHaveLength(1);
  });

  it('is a no-op for a board that has no subitem columns', () => {
    const board = [col('t', 'text', 'Notes')];
    const plan = planSubitemColumnMerge(board, [], [{ id: 'a', values: { t: 'x' } }], ['t']);
    expect(plan.decisions).toEqual([]);
    expect(plan.columns).toEqual(board);
    expect(plan.copies).toEqual([]);
    expect(plan.removals).toEqual([]);
    expect(plan.columnLocks).toEqual(['t']);
  });
});
