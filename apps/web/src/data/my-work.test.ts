import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeItem, ts } from '../test/fixtures';
import { MY_WORK_BOARD_CAP, boardsForMyWork, isAssignedTo } from './my-work';

vi.mock('../lib/firebase', () => ({ db: {} }));

const people = (id: string) => ({ id, type: 'people', title: id, position: 'a0', settings: {} });
const mine = { personsAndTeams: [{ id: 'u1', kind: 'person' }] };

describe('isAssignedTo', () => {
  const board = makeBoard({ id: 'b1', columns: [people('owner')] as never });

  it('keeps an item whose People column still lists the user', () => {
    expect(isAssignedTo(board, makeItem({ id: 'i', values: { owner: mine } }), 'u1')).toBe(true);
  });

  it('drops a stale hint after the People column was deleted or the person removed', () => {
    const noColumns = makeBoard({ id: 'b1', columns: [] });
    expect(isAssignedTo(noColumns, makeItem({ id: 'i', values: { owner: mine } }), 'u1')).toBe(
      false,
    );
    const emptied = makeItem({ id: 'i', values: { owner: { personsAndTeams: [] } } });
    expect(isAssignedTo(board, emptied, 'u1')).toBe(false);
  });

  it('ignores teams and uses the subitem columns for subitems', () => {
    const team = { personsAndTeams: [{ id: 'u1', kind: 'team' }] };
    expect(isAssignedTo(board, makeItem({ id: 'i', values: { owner: team } }), 'u1')).toBe(false);
    const withSub = makeBoard({ id: 'b2', columns: [], subitemColumns: [people('sub')] as never });
    const sub = makeItem({ id: 's', parentItemId: 'p', values: { sub: mine } });
    expect(isAssignedTo(withSub, sub, 'u1')).toBe(true);
  });
});

describe('boardsForMyWork', () => {
  it('orders by latest visit, then name, and caps at 100', () => {
    const boards = [
      makeBoard({ id: 'b', name: 'Beta' }),
      makeBoard({ id: 'a', name: 'Alpha' }),
      makeBoard({ id: 'c', name: 'Gamma' }),
    ];
    const ordered = boardsForMyWork(boards, [{ boardId: 'c', visitedAt: ts(5_000) as never }]);
    expect(ordered.map((b) => b.id)).toEqual(['c', 'a', 'b']);

    const many = Array.from({ length: MY_WORK_BOARD_CAP + 5 }, (_, i) =>
      makeBoard({ id: `b${i}`, name: `Board ${String(i).padStart(3, '0')}` }),
    );
    expect(boardsForMyWork(many, [])).toHaveLength(MY_WORK_BOARD_CAP);
  });
});
