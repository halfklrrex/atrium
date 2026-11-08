import { describe, expect, it } from 'vitest';
import { makeItem } from '../../test/fixtures';
import { largeBoard, smallBoard, subitemBoard } from '../../test/workbook-boards';
import { SUMMARY_PEOPLE_CAP, buildBoardWorkbookData } from './workbook-data';

describe('buildBoardWorkbookData', () => {
  it('computes the headline figures with the app rules', () => {
    const data = buildBoardWorkbookData(smallBoard());
    // i1 working (due in 2 days), i2 done (past), i3 stuck (past), i4 no status, no date.
    expect(data.figures).toEqual({
      items: 4,
      groups: 3,
      done: 1,
      inProgress: 2,
      overdue: 1,
      dueSoon: 1,
      noDate: 1,
      people: 3,
    });
    expect(data.exportedLabel).toBe('Nov 8, 2026, 14:32');
    expect(data.selection).toBeNull();
  });

  it('breaks down status and priority by label, with "Not set" last', () => {
    const data = buildBoardWorkbookData(smallBoard());
    expect(data.status?.title).toBe('Status');
    expect(data.status?.rows).toEqual([
      { label: 'Working on it', color: '#fdab3d', count: 1 },
      { label: 'Done', color: '#00c875', count: 1 },
      { label: 'Stuck', color: '#df2f4a', count: 1 },
      { label: 'Not set', color: null, count: 1 },
    ]);
    expect(data.priority?.title).toBe('Priority');
    expect(data.priority?.rows.map((r) => r.label)).toEqual([
      'Critical ⚠️',
      'High',
      'Medium',
      'Not set',
    ]);
  });

  it('counts groups and people with done items, and Unassigned last', () => {
    const data = buildBoardWorkbookData(smallBoard());
    expect(data.groups.rows).toEqual([
      { label: 'This sprint', color: '#579bfc', count: 2, done: 1 },
      { label: 'Next sprint', color: '#a25ddc', count: 1, done: 0 },
      { label: 'Done', color: '#00c875', count: 1, done: 0 },
    ]);
    expect(data.people?.title).toBe('Workload by Owner');
    expect(data.people?.rows).toEqual([
      { label: 'Avery Quinn', color: null, count: 2, done: 0 },
      { label: 'Blake Rivera', color: null, count: 1, done: 1 },
      { label: 'Casey Morgan', color: null, count: 1, done: 0 },
      { label: 'Unassigned', color: null, count: 1, done: 0 },
    ]);
    expect(data.stripe).toEqual(['#fdab3d', '#00c875', '#df2f4a', '#579bfc']);
  });

  it('lists subitems on Items under their parent with its group colour', () => {
    const data = buildBoardWorkbookData(subitemBoard());
    expect(data.items.hasSubitems).toBe(true);
    expect(data.items.header.slice(0, 3)).toEqual(['Item', 'Group', 'Parent item']);
    const rows = data.items.rows.map((r) => [r.cells[0], r.subitem, r.groupColor]);
    expect(rows.slice(0, 3)).toEqual([
      ['=HYPERLINK("http://example.com")', false, '#579bfc'],
      ['Draft', true, '#579bfc'],
      ['+1 for review', true, '#579bfc'],
    ]);
    // Figures count top-level items only.
    expect(data.figures.items).toBe(3);
  });

  it('describes only the selection for a batch-bar export', () => {
    const data = buildBoardWorkbookData({ ...smallBoard(), itemIds: ['i2', 'i3'] });
    expect(data.selection).toEqual({ count: 2, total: 4 });
    expect(data.figures.items).toBe(2);
    expect(data.items.rows.map((r) => r.cells[0])).toEqual(['Write the copy', 'Fix the login bug']);
  });

  it('caps the people table and says how many more there are', () => {
    const input = smallBoard();
    const items = Array.from({ length: SUMMARY_PEOPLE_CAP + 5 }, (_, i) =>
      makeItem({
        id: `p${i}`,
        values: { owner: { personsAndTeams: [{ id: `x${i}`, kind: 'person' }] } },
      }),
    );
    const data = buildBoardWorkbookData({ ...input, items });
    expect(data.people?.rows).toHaveLength(SUMMARY_PEOPLE_CAP);
    expect(data.people?.more).toBe(5);
  });

  it('says when the board has no column for a figure', () => {
    const input = smallBoard();
    const data = buildBoardWorkbookData({
      ...input,
      columns: input.columns.filter((c) => c.type === 'numbers'),
    });
    expect(data.figures).toMatchObject({
      done: null,
      inProgress: null,
      overdue: null,
      dueSoon: null,
      noDate: null,
      people: null,
    });
    expect(data.status).toBeNull();
    expect(data.people).toBeNull();
    expect(data.stripe).toEqual(['#579bfc', '#a25ddc', '#00c875']);
  });

  it('handles thousands of items quickly', () => {
    const start = performance.now();
    const data = buildBoardWorkbookData(largeBoard(5000));
    expect(data.items.rows.length).toBeGreaterThan(5000);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
