import type { ColumnDef } from '@atrium/shared';
import { makeBoard, makeItem } from '../../../test/fixtures';
import type { WidgetBoardData } from './widget-columns';

export const column = (
  id: string,
  type: string,
  title: string,
  settings: Record<string, unknown> = {},
): ColumnDef => ({ id, type, title, position: 'a0', settings }) as ColumnDef;

export const statusColumn = (id = 'status', title = 'Status') =>
  column(id, 'status', title, {
    labels: [
      { id: 'work', index: 0, label: 'Working on it', color: '#fdab3d' },
      { id: 'done', index: 1, label: 'Done', color: '#00c875', isDone: true },
      { id: 'stuck', index: 2, label: 'Stuck', color: '#df2f4a' },
    ],
  });

/** Status cell by label id of `statusColumn`. */
export const status = (index: number) => ({ index });

/**
 * Two boards. Board 1: Amount (numbers), Total (formula = Amount * 2), Status. Board 2 has the
 * same columns under other ids and a different "Done" label id, so cross-board matching is tested.
 */
export function twoBoards(): WidgetBoardData[] {
  const b1 = makeBoard({
    id: 'b1',
    name: 'Sales',
    columns: [
      column('amount', 'numbers', 'Amount'),
      column('total', 'formula', 'Total', { expression: '{Amount} * 2', outputType: 'number' }),
      statusColumn('status'),
    ],
  });
  const b2 = makeBoard({
    id: 'b2',
    name: 'Orders',
    columns: [column('amt2', 'numbers', 'amount'), statusColumn('st2')],
  });
  b2.columns[1] = column('st2', 'status', 'Status', {
    labels: [
      { id: 'finished', index: 0, label: 'done', color: '#00c875', isDone: true },
      { id: 'wip', index: 1, label: 'Working on it', color: '#fdab3d' },
    ],
  });
  return [
    {
      board: b1,
      items: [
        makeItem({ id: 'i1', values: { amount: 10, status: status(1) } }),
        makeItem({ id: 'i2', values: { amount: '5.5', status: status(0) } }),
        makeItem({ id: 'i3', values: { status: status(2) } }),
      ],
    },
    {
      board: b2,
      items: [
        makeItem({ id: 'j1', values: { amt2: 20, st2: status(0) } }),
        makeItem({ id: 'j2', values: { amt2: 4, st2: status(1) } }),
        makeItem({ id: 'j3', values: {} }),
      ],
    },
  ];
}
