import type { ColumnDef, GroupDef } from '@atrium/shared';
import { describe, expect, it } from 'vitest';
import { makeItem } from '../../test/fixtures';
import { boardCsvText, buildBoardCsvRows } from './board-export';

const col = (
  id: string,
  type: string,
  title: string,
  position: string,
  settings: Record<string, unknown> = {},
): ColumnDef => ({ id, type, title, position, settings });

const statusSettings = {
  labels: [
    { id: 'done', index: 0, label: 'Done', color: '#00c875' },
    { id: 'stuck', index: 1, label: 'Stuck', color: '#df2f4a' },
  ],
};

const columns: ColumnDef[] = [
  col('price', 'numbers', 'Price', 'a4', { decimals: 2 }),
  col('status', 'status', 'Status', 'a1', statusSettings),
  col('tags', 'dropdown', 'Area', 'a2', {
    labels: [
      { id: 1, label: 'Web' },
      { id: 2, label: 'Back, end' },
    ],
    limitSelect: false,
  }),
  col('owner', 'people', 'Owner', 'a3'),
  col('due', 'date', 'Due', 'a5'),
  col('ok', 'checkbox', 'OK', 'a6'),
  col('total', 'formula', 'Double', 'a7', { expression: '{Price} * 2', outputType: 'number' }),
];
const groups: GroupDef[] = [
  { id: 'g1', title: 'Backlog', color: '#579bfc', position: 'a0' },
  { id: 'g2', title: 'Done', color: '#00c875', position: 'a1' },
];
const names: Record<string, string> = { u1: 'Avery Quinn', u2: 'Blake Rivera' };
const personNames = (uid: string) => names[uid];

const base = {
  board: { id: 'b1' },
  columns,
  groups,
  hiddenColumnIds: [] as string[],
  personNames,
  subitems: [],
};

const full = makeItem({
  id: 'i1',
  name: 'Ship, "v1"',
  values: {
    status: { index: 1 },
    tags: { ids: [1, 2] },
    owner: {
      personsAndTeams: [
        { id: 'u1', kind: 'person' },
        { id: 'u2', kind: 'person' },
      ],
    },
    price: '-4.5',
    due: { date: '2026-03-04' },
    ok: { checked: true },
  },
});

describe('buildBoardCsvRows', () => {
  it('writes the header in column position order and one row per item', () => {
    const rows = buildBoardCsvRows({ ...base, items: [full] });
    expect(rows[0]).toEqual([
      'Item',
      'Group',
      'Status',
      'Area',
      'Owner',
      'Price',
      'Due',
      'OK',
      'Double',
    ]);
    expect(rows).toHaveLength(2);
    const row = rows[1]!;
    expect(row[0]).toBe('Ship, "v1"');
    expect(row[1]).toBe('Backlog');
    expect(row[2]).toBe('Stuck');
    expect(row[3]).toContain('Web');
    expect(row[3]).toContain('Back, end');
    expect(row[6]).toContain('2026-03-04');
  });

  it('exports people as display names, not uids', () => {
    const rows = buildBoardCsvRows({ ...base, items: [full] });
    expect(rows[1]![4]).toBe('Avery Quinn, Blake Rivera');
    const unknown = makeItem({
      id: 'i2',
      values: { owner: { personsAndTeams: [{ id: 'gone', kind: 'person' }] } },
    });
    expect(buildBoardCsvRows({ ...base, items: [unknown] })[1]![4]).toBe('Board member');
  });

  it('keeps the old CSV fallback for a team entry', () => {
    const withTeam = makeItem({
      id: 'i3',
      values: { owner: { personsAndTeams: [{ id: 't1', kind: 'team' }] } },
    });
    expect(buildBoardCsvRows({ ...base, items: [withTeam] })[1]![4]).toBe('Board member');
  });

  it('marks numeric cells and exports the computed formula value', () => {
    const rows = buildBoardCsvRows({ ...base, items: [full] });
    const row = rows[1]!;
    expect(row[5]).toEqual({ text: '-4.50', numeric: true });
    expect(row[8]).toEqual({ text: '-9', numeric: true });
  });

  it('keeps empty cells empty', () => {
    const rows = buildBoardCsvRows({ ...base, items: [makeItem({ id: 'e', groupId: 'g2' })] });
    expect(rows[1]!.slice(0, 8)).toEqual(['e', 'Done', '', '', '', '', '', '']);
  });

  it('skips the columns the view hides', () => {
    const rows = buildBoardCsvRows({
      ...base,
      hiddenColumnIds: ['status', 'total'],
      items: [full],
    });
    expect(rows[0]).toEqual(['Item', 'Group', 'Area', 'Owner', 'Price', 'Due', 'OK']);
    expect(rows[1]).toHaveLength(7);
  });

  it('follows the order of the items it is given and drops archived and trashed ones', () => {
    const rows = buildBoardCsvRows({
      ...base,
      items: [
        makeItem({ id: 'b', name: 'B' }),
        makeItem({ id: 'x', name: 'Gone', state: 'archived' }),
        makeItem({ id: 'y', name: 'Binned', state: 'deleted' }),
        makeItem({ id: 'a', name: 'A' }),
      ],
    });
    expect(rows.slice(1).map((r) => r[0])).toEqual(['B', 'A']);
  });

  it('puts subitems under their parent with the parent name and no group', () => {
    const rows = buildBoardCsvRows({
      ...base,
      subitemColumns: [col('status', 'status', 'Status', 'a1', statusSettings)],
      items: [makeItem({ id: 'p1', name: 'Parent 1' }), makeItem({ id: 'p2', name: 'Parent 2' })],
      subitems: [
        makeItem({ id: 's2', name: 'Second', parentItemId: 'p1', position: 'a2' }),
        makeItem({
          id: 's1',
          name: 'First',
          parentItemId: 'p1',
          position: 'a1',
          values: { status: { index: 0 } },
        }),
        makeItem({ id: 's3', name: 'Archived', parentItemId: 'p1', state: 'archived' }),
        makeItem({ id: 's4', name: 'Other', parentItemId: 'p2' }),
      ],
    });
    expect(rows[0]!.slice(0, 3)).toEqual(['Item', 'Group', 'Parent item']);
    expect(rows.slice(1).map((r) => [r[0], r[1], r[2]])).toEqual([
      ['Parent 1', 'Backlog', ''],
      ['First', '', 'Parent 1'],
      ['Second', '', 'Parent 1'],
      ['Parent 2', 'Backlog', ''],
      ['Other', '', 'Parent 2'],
    ]);
    expect(rows[2]![3]).toBe('Done');
  });
});

describe('boardCsvText', () => {
  it('starts with the BOM and escapes through the shared helpers', () => {
    const rows = buildBoardCsvRows({
      ...base,
      items: [makeItem({ id: 'f', name: '=HYPERLINK("x")' }), full],
    });
    const text = boardCsvText(rows);
    expect(text.startsWith('﻿Item,Group,')).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text).toContain('"Ship, ""v1"""');
    expect(text).toContain(',-4.50,');
    expect(text).toContain('\r\n');
  });
});
