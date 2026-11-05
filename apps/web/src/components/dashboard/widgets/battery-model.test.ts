import { describe, expect, it, vi } from 'vitest';
import { makeBoard } from '../../../test/fixtures';
import { BATTERY_EMPTY_KEY, buildBatteryModel, type BatterySettings } from './battery-model';
import { column, twoBoards } from './widget-test-data';

vi.mock('../../../lib/firebase', () => ({ db: {} }));

const settings = (patch: Partial<BatterySettings> = {}): BatterySettings => ({
  statusColumnId: null,
  doneLabelIds: [],
  ...patch,
});

const run = (patch: Partial<BatterySettings> = {}, widgetBoardIds: string[] = []) =>
  buildBatteryModel({ boards: twoBoards(), widgetBoardIds, settings: settings(patch) });

describe('buildBatteryModel', () => {
  it('merges segments by label text across boards and counts flagged-done labels', () => {
    const model = run();
    const byLabel = Object.fromEntries(model.segments.map((s) => [s.label, s.count]));
    // Sales: Done 1, Working on it 1, Stuck 1. Orders: done 1, Working on it 1, one item unset.
    expect(byLabel['Done']).toBe(2);
    expect(byLabel['Working on it']).toBe(2);
    expect(byLabel['Stuck']).toBe(1);
    expect(byLabel['Not set']).toBe(1);
    expect(model.total).toBe(6);
    expect(model.doneCount).toBe(2);
    expect(model.percent).toBe(33);
  });

  it('puts items without a status in a trailing "Not set" segment', () => {
    const model = run();
    expect(model.segments.at(-1)).toMatchObject({
      key: BATTERY_EMPTY_KEY,
      color: null,
      done: false,
    });
  });

  it('uses the chosen done labels instead of the done flag', () => {
    const model = run({ statusColumnId: 'status', doneLabelIds: ['stuck'] });
    // Stuck is not flagged done on the board, but the widget says it counts: Sales i3 only
    // (Orders has no "stuck" label id, so none there)
    expect(model.doneCount).toBe(1);
  });

  it('limits to the widget boards', () => {
    const model = run({}, ['b1']);
    expect(model.total).toBe(3);
    expect(model.percent).toBe(33);
  });

  it('reports boards with no status column and an empty total', () => {
    const board = makeBoard({ id: 'plain', columns: [column('t', 'text', 'Notes')] });
    const model = buildBatteryModel({
      boards: [{ board, items: [] }],
      widgetBoardIds: [],
      settings: settings(),
    });
    expect(model.total).toBe(0);
    expect(model.percent).toBe(0);
    expect(model.boardsWithoutStatus).toBe(1);
    expect(model.summary).toBe('No items');
  });
});
