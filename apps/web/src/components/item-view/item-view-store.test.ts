import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openItem, openItemFull } from '../board-table/open-item';
import { useItemCardStore } from '../item-card/item-card-store';
import {
  neighbours,
  subitemNeighbours,
  subitemOpenState,
  useItemViewStore,
} from './item-view-store';

const groups = [
  { groupId: 'g1', ids: ['a', 'b', 'c'] },
  { groupId: 'g2', ids: ['d'] },
];

describe('neighbours', () => {
  it('steps through the item group only', () => {
    expect(neighbours(groups, 'b')).toMatchObject({ prev: 'a', next: 'c', index: 1, total: 3 });
    expect(neighbours(groups, 'a').prev).toBeNull();
    expect(neighbours(groups, 'c').next).toBeNull();
    expect(neighbours(groups, 'd')).toMatchObject({ prev: null, next: null, total: 1 });
    expect(neighbours(groups, 'zzz').total).toBe(0);
    expect(neighbours(undefined, 'a').total).toBe(0);
  });
});

describe('subitemNeighbours', () => {
  const sub = (id: string, position: string, parentItemId: string | null = 'p') => ({
    id,
    position,
    parentItemId,
  });
  const all = [
    sub('p', 'a0', null),
    sub('s2', 'a1'),
    sub('s1', 'a0'),
    sub('s3', 'a2'),
    sub('o', 'a0', 'q'),
  ];

  it('steps through the siblings of the same parent in position order', () => {
    expect(subitemNeighbours(all, sub('s2', 'a1'))).toEqual({
      prev: 's1',
      next: 's3',
      index: 1,
      total: 3,
    });
    expect(subitemNeighbours(all, sub('s1', 'a0')).prev).toBeNull();
    expect(subitemNeighbours(all, sub('s3', 'a2')).next).toBeNull();
  });

  it('has no siblings for an item without a parent', () => {
    expect(subitemNeighbours(all, sub('p', 'a0', null)).total).toBe(0);
  });
});

describe('subitemOpenState', () => {
  it('records the parent and keeps fromBoard', () => {
    expect(subitemOpenState({ fromBoard: true, section: 'subitems' }, 'p')).toEqual({
      fromBoard: true,
      fromItem: 'p',
    });
    expect(subitemOpenState(null, 'p')).toEqual({ fromItem: 'p' });
  });
});

describe('opening items', () => {
  beforeEach(() => {
    useItemCardStore.getState().closeItemCard();
    useItemViewStore.setState({ navigate: null, openBoardId: null });
  });

  it('opens the full view by navigating to the item URL and closes the side panel', () => {
    const navigate = vi.fn();
    useItemViewStore.getState().setNavigate(navigate);
    useItemCardStore.getState().open('b1', 'x');
    openItemFull('b1', 'i1');
    expect(navigate).toHaveBeenCalledWith('/boards/b1/items/i1', { state: { fromBoard: true } });
    expect(useItemCardStore.getState().activeItemId).toBeNull();
  });

  it('uses the board name for the URL when it is known', () => {
    const navigate = vi.fn();
    useItemViewStore.getState().setNavigate(navigate);
    useItemViewStore.getState().setBoardName('b1', 'Q4 Roadmap');
    openItemFull('b1', 'i1');
    expect(navigate).toHaveBeenCalledWith('/boards/q4-roadmap-b1/items/i1', {
      state: { fromBoard: true },
    });
    useItemViewStore.setState({ boardNames: {} });
  });

  it('opening the side panel goes back to the board when the window is open', () => {
    const navigate = vi.fn();
    useItemViewStore.setState({ navigate, openBoardId: 'b1' });
    openItem('b1', 'i2');
    expect(navigate).toHaveBeenCalledWith('/boards/b1', { replace: true });
    expect(useItemCardStore.getState().activeItemId).toBe('i2');
  });

  it('falls back to the side panel without a router', () => {
    openItemFull('b1', 'i1');
    expect(useItemCardStore.getState().activeItemId).toBe('i1');
  });
});
