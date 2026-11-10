import { beforeEach, describe, expect, it } from 'vitest';
import { useItemCardStore } from './item-card-store';

describe('useItemCardStore', () => {
  beforeEach(() => {
    useItemCardStore.getState().closeItemCard();
    useItemCardStore.getState().setItemIds([]);
  });

  it('starts closed', () => {
    const state = useItemCardStore.getState();
    expect(state.activeBoardId).toBeNull();
    expect(state.activeItemId).toBeNull();
    expect(state.itemIds).toEqual([]);
  });

  it('openItemCard sets active board, item and optional list', () => {
    useItemCardStore.getState().openItemCard('board-1', 'item-1', ['item-0', 'item-1', 'item-2']);
    const state = useItemCardStore.getState();
    expect(state.activeBoardId).toBe('board-1');
    expect(state.activeItemId).toBe('item-1');
    expect(state.itemIds).toEqual(['item-0', 'item-1', 'item-2']);
  });

  it('closeItemCard resets active board and item', () => {
    useItemCardStore.getState().openItemCard('board-1', 'item-1');
    useItemCardStore.getState().closeItemCard();
    const state = useItemCardStore.getState();
    expect(state.activeBoardId).toBeNull();
    expect(state.activeItemId).toBeNull();
  });

  it('setActiveItemId changes active item for navigation', () => {
    useItemCardStore.getState().openItemCard('board-1', 'item-1', ['item-1', 'item-2']);
    useItemCardStore.getState().setActiveItemId('item-2');
    expect(useItemCardStore.getState().activeItemId).toBe('item-2');
  });

  it('opens on Overview by default and on the named tab otherwise', () => {
    useItemCardStore.getState().open('board-1', 'item-1');
    expect(useItemCardStore.getState().tab).toBe('overview');
    useItemCardStore.getState().open('board-1', 'item-1', [], 'updates');
    expect(useItemCardStore.getState().tab).toBe('updates');
  });

  it('keeps the tab when stepping to another item, and resets it after a close', () => {
    useItemCardStore.getState().open('board-1', 'item-1', ['item-1', 'item-2'], 'updates');
    useItemCardStore.getState().setActiveItemId('item-2');
    expect(useItemCardStore.getState().tab).toBe('updates');
    useItemCardStore.getState().closeItemCard();
    useItemCardStore.getState().open('board-1', 'item-1');
    expect(useItemCardStore.getState().tab).toBe('overview');
  });

  it('setTab changes the tab', () => {
    useItemCardStore.getState().open('board-1', 'item-1');
    useItemCardStore.getState().setTab('activity');
    expect(useItemCardStore.getState().tab).toBe('activity');
  });
});
