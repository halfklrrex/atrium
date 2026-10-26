import { describe, expect, it } from 'vitest';
import { getThirtyDayCutoff, purgeTrashLogic, THIRTY_DAYS_MS, type PurgeTrashStore } from './purge';

describe('purgeTrashLogic', () => {
  it('computes 30-day cutoff properly', () => {
    const fixedNow = 1700000000000;
    const cutoff = getThirtyDayCutoff(fixedNow);
    expect(cutoff.getTime()).toBe(fixedNow - THIRTY_DAYS_MS);
  });

  it('purges boards recursively and deletes items past the cutoff', async () => {
    const deletedItemsList = [
      { id: 'item-1', boardId: 'board-1' },
      { id: 'item-2', boardId: 'board-2' },
    ];
    const deletedBoardsList = [{ id: 'board-old' }];

    const purgedBoards: string[] = [];
    const deletedItems: string[] = [];

    const mockStore: PurgeTrashStore = {
      findDeletedBoards: async () => deletedBoardsList,
      findDeletedItems: async () => deletedItemsList,
      purgeBoard: async (id) => {
        purgedBoards.push(id);
      },
      deleteItems: async (items) => {
        deletedItems.push(...items.map((it) => it.id));
        return items.length;
      },
    };

    const cutoff = new Date();
    const result = await purgeTrashLogic(mockStore, cutoff);

    expect(result.boardsPurged).toBe(1);
    expect(result.itemsPurged).toBe(2);
    expect(purgedBoards).toEqual(['board-old']);
    expect(deletedItems).toEqual(['item-1', 'item-2']);
  });

  it('skips delete when nothing is past the cutoff', async () => {
    let calledPurgeBoard = false;
    let calledDeleteItems = false;
    const mockStore: PurgeTrashStore = {
      findDeletedBoards: async () => [],
      findDeletedItems: async () => [],
      purgeBoard: async () => {
        calledPurgeBoard = true;
      },
      deleteItems: async () => {
        calledDeleteItems = true;
        return 0;
      },
    };

    const result = await purgeTrashLogic(mockStore, new Date());
    expect(result.boardsPurged).toBe(0);
    expect(result.itemsPurged).toBe(0);
    expect(calledPurgeBoard).toBe(false);
    expect(calledDeleteItems).toBe(false);
  });
});
