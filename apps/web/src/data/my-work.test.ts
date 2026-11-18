import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeItem, ts } from '../test/fixtures';
import { MY_WORK_BOARD_CAP, boardsForMyWork, isAssignedTo, myTeamsIn, viaTeamOf } from './my-work';
import type { TeamDoc } from './model';

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

  it('ignores teams and uses the board columns for subitems', () => {
    const team = { personsAndTeams: [{ id: 'u1', kind: 'team' }] };
    expect(isAssignedTo(board, makeItem({ id: 'i', values: { owner: team } }), 'u1')).toBe(false);
    const withSub = makeBoard({ id: 'b2', columns: [people('sub')] as never });
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

describe('viaTeamOf and myTeamsIn (TEAMS PR 3)', () => {
  const board = makeBoard({ id: 'b1', columns: [people('owner')] as never });
  const team = (id: string, ...ids: string[]) => ({
    personsAndTeams: [{ id, kind: 'team' }, ...ids.map((i) => ({ id: i, kind: 'person' }))],
  });
  const kids = { id: 'kids', name: 'Kids' };

  it('returns the first of my teams the item is assigned to', () => {
    const item = makeItem({ id: 'i', values: { owner: team('kids') } });
    expect(viaTeamOf(board, item, [{ id: 'parents', name: 'Parents' }, kids])).toEqual(kids);
  });

  it('is undefined for another team, a person entry, no teams, or a deleted People column', () => {
    const item = makeItem({ id: 'i', values: { owner: team('other') } });
    expect(viaTeamOf(board, item, [kids])).toBeUndefined();
    expect(
      viaTeamOf(board, makeItem({ id: 'i', values: { owner: mine } }), [kids]),
    ).toBeUndefined();
    expect(
      viaTeamOf(board, makeItem({ id: 'i', values: { owner: team('kids') } }), []),
    ).toBeUndefined();
    const noColumns = makeBoard({ id: 'b1', columns: [] });
    expect(
      viaTeamOf(noColumns, makeItem({ id: 'i', values: { owner: team('kids') } }), [kids]),
    ).toBeUndefined();
  });

  it('lists only the teams the person belongs to, sorted by id, at most 30', () => {
    const doc = (id: string, memberUids: string[]) =>
      ({ id, name: `Team ${id}`, memberUids }) as unknown as TeamDoc;
    expect(myTeamsIn([doc('b', ['u1']), doc('a', ['u1', 'u2']), doc('c', ['u2'])], 'u1')).toEqual([
      { id: 'a', name: 'Team a' },
      { id: 'b', name: 'Team b' },
    ]);
    const many = Array.from({ length: 35 }, (_, i) =>
      doc(`t${String(i).padStart(2, '0')}`, ['u1']),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(myTeamsIn(many, 'u1')).toHaveLength(30);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
