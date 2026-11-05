import { defaultChartSettings, type ChartSettings } from '@atrium/shared';
import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeItem } from '../../../test/fixtures';
import { buildMultiBoardChartModel } from './chart-widget-model';
import { column, status, statusColumn, twoBoards } from './widget-test-data';
import type { WidgetBoardData } from './widget-columns';

vi.mock('../../../lib/firebase', () => ({ db: {} }));

const run = (
  patch: Partial<ChartSettings> = {},
  boards: WidgetBoardData[] = twoBoards(),
  widgetBoardIds: string[] = [],
) =>
  buildMultiBoardChartModel({
    boards,
    widgetBoardIds,
    settings: { ...defaultChartSettings(), ...patch },
    userName: (uid) => (uid === 'u1' ? 'Avery Quinn' : uid === 'u2' ? 'Blair Reed' : undefined),
  });

const byLabel = (model: ReturnType<typeof run>) =>
  Object.fromEntries(model.buckets.map((b) => [b.label, b.count]));

describe('buildMultiBoardChartModel', () => {
  it('merges status buckets of two boards by label text', () => {
    const model = run({ xColumnId: 'status' });
    expect(model.itemCount).toBe(6);
    // "Done" on Sales and "done" on Orders land in one bucket despite different label ids.
    expect(byLabel(model)).toEqual({ 'Working on it': 2, Done: 2, Stuck: 1, Empty: 1 });
  });

  it('defaults to the first status column and limits to the widget boards', () => {
    const model = run({}, twoBoards(), ['b2']);
    expect(model.itemCount).toBe(3);
    expect(byLabel(model)).toEqual({ 'Working on it': 1, Done: 1, Empty: 1 });
  });

  it('sums a Numbers column across boards, matched by title', () => {
    const model = run({ xColumnId: 'status', yMode: 'sum', yColumnId: 'amount' });
    const done = model.buckets.find((b) => b.label === 'Done');
    expect(done?.value).toBe(30); // 10 on Sales + 20 on Orders
  });

  it('reads a number Formula column as the measure', () => {
    const model = run({ xColumnId: 'status', yMode: 'sum', yColumnId: 'total' });
    const done = model.buckets.find((b) => b.label === 'Done');
    // The formula only exists on Sales: 10 * 2.
    expect(done?.value).toBe(20);
    expect(model.yFallback).toBeNull();
  });

  it('falls back to counting when no board has a numeric column', () => {
    const board = makeBoard({ id: 'x', columns: [statusColumn('status')] });
    const model = run({ yMode: 'sum', yColumnId: 'amount' }, [
      { board, items: [makeItem({ id: 'a', values: { status: status(0) } })] },
    ]);
    expect(model.yFallback).not.toBeNull();
    expect(model.buckets[0]?.count).toBe(1);
  });

  it('stacks by a second merged status column', () => {
    const model = run({ chartType: 'stacked_bar', xColumnId: '__group' });
    expect(model.series.map((s) => s.label).sort()).toEqual(
      ['Done', 'Empty', 'Stuck', 'Working on it'].sort(),
    );
  });

  it('merges groups by title', () => {
    const [b1, b2] = twoBoards();
    b1!.board.groups = [{ id: 'ga', title: 'Q1', color: '#579bfc', position: 'a0' }];
    b2!.board.groups = [{ id: 'gb', title: 'q1', color: '#00c875', position: 'a0' }];
    for (const i of b1!.items) i.groupId = 'ga';
    for (const i of b2!.items) i.groupId = 'gb';
    const model = run({ xColumnId: '__group' }, [b1!, b2!]);
    expect(model.buckets).toHaveLength(1);
    expect(model.buckets[0]).toMatchObject({ label: 'Q1', count: 6 });
  });

  it('merges people by user id and dates by bucket', () => {
    const people = (id: string) => column(id, 'people', 'Owner');
    const date = (id: string) => column(id, 'date', 'Due');
    const person = (uid: string) => ({ personsAndTeams: [{ id: uid, kind: 'person' }] });
    const b1 = makeBoard({ id: 'p1', columns: [people('o1'), date('d1')] });
    const b2 = makeBoard({ id: 'p2', columns: [people('o2'), date('d2')] });
    const boards: WidgetBoardData[] = [
      {
        board: b1,
        items: [makeItem({ id: 'a', values: { o1: person('u1'), d1: { date: '2026-03-02' } } })],
      },
      {
        board: b2,
        items: [
          makeItem({ id: 'b', values: { o2: person('u1'), d2: { date: '2026-03-20' } } }),
          makeItem({ id: 'c', values: { o2: person('u2'), d2: { date: '2026-04-01' } } }),
        ],
      },
    ];
    const byPerson = run({ xColumnId: 'o1' }, boards);
    expect(byLabel(byPerson)).toEqual({ 'Avery Quinn': 2, 'Blair Reed': 1 });
    const byMonth = run({ xColumnId: 'd1', dateBucket: 'month' }, boards);
    expect(byMonth.buckets.map((b) => [b.key, b.count])).toEqual([
      ['2026-03', 2],
      ['2026-04', 1],
    ]);
  });

  it('handles empty boards and a board without the chosen column', () => {
    const empty = makeBoard({ id: 'e', columns: [statusColumn('status')] });
    expect(run({}, [{ board: empty, items: [] }]).itemCount).toBe(0);
    const [b1] = twoBoards();
    const bare = makeBoard({ id: 'bare', columns: [] });
    const model = run({ xColumnId: 'status' }, [
      b1!,
      { board: bare, items: [makeItem({ id: 'z' })] },
    ]);
    expect(byLabel(model).Empty).toBe(1);
  });
});
