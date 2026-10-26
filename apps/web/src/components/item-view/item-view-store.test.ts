import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openItem, openItemFull } from '../board-table/open-item';
import { useItemCardStore } from '../item-card/item-card-store';
import { neighbours, useItemViewStore } from './item-view-store';

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
