import { describe, expect, it } from 'vitest';
import {
  syncItemIndexFields,
  withSharedBoardRead,
  type ItemIndexChange,
  type ItemIndexStore,
} from './item-index';
import { notifyPeopleAssigned, type NotificationStore } from './notifications';

const board = {
  columns: [
    { id: 'owner', type: 'people' },
    { id: 'status', type: 'status' },
  ],
  subitemColumns: [{ id: 'sub_owner', type: 'people' }],
};

const people = (...ids: string[]) => ({
  personsAndTeams: ids.map((id) => ({ id, kind: 'person' as const })),
});

class FakeStore implements ItemIndexStore {
  boardReads = 0;
  writes: Array<{ boardId: string; itemId: string; fields: unknown; expected: unknown }> = [];
  board: typeof board | null = board;
  getBoard() {
    this.boardReads += 1;
    return Promise.resolve(this.board);
  }
  setItemIndex(boardId: string, itemId: string, fields: unknown, expected?: unknown) {
    this.writes.push({ boardId, itemId, fields, expected });
    return Promise.resolve(true);
  }
}

const change = (overrides: Partial<ItemIndexChange> = {}): ItemIndexChange => ({
  boardId: 'b1',
  itemId: 'i1',
  after: { name: 'Plan Q3', values: { owner: people('u2', 'u1') }, parentItemId: null },
  ...overrides,
});

describe('syncItemIndexFields', () => {
  it('writes both fields on create', async () => {
    const store = new FakeStore();
    expect(await syncItemIndexFields(store, change({ updateTime: 'v1' }))).toBe(true);
    expect(store.writes).toEqual([
      {
        boardId: 'b1',
        itemId: 'i1',
        fields: { assigneeUids: ['u1', 'u2'], nameTokens: ['pl', 'pla', 'plan', 'q3'] },
        expected: 'v1',
      },
    ]);
    expect(store.boardReads).toBe(1);
  });

  it('writes only the two index fields (never updatedAt or updatedBy)', async () => {
    const store = new FakeStore();
    await syncItemIndexFields(store, change());
    expect(Object.keys(store.writes[0]?.fields as object).sort()).toEqual([
      'assigneeUids',
      'nameTokens',
    ]);
  });

  it('a rename rewrites the tokens without reading the board', async () => {
    const store = new FakeStore();
    const values = { owner: people('u1') };
    await syncItemIndexFields(
      store,
      change({
        before: { name: 'Plan Q3', values },
        after: {
          name: 'Review',
          values,
          assigneeUids: ['u1'],
          nameTokens: ['pl', 'pla', 'plan', 'q3'],
        },
      }),
    );
    expect(store.boardReads).toBe(0);
    expect(store.writes[0]?.fields).toEqual({
      assigneeUids: ['u1'],
      nameTokens: ['re', 'rev', 'revi', 'revie', 'review'],
    });
  });

  it('a values change rewrites the assignees', async () => {
    const store = new FakeStore();
    await syncItemIndexFields(
      store,
      change({
        before: { name: 'Plan', values: { owner: people('u1') } },
        after: {
          name: 'Plan',
          values: { owner: people('u3') },
          assigneeUids: ['u1'],
          nameTokens: ['pl', 'pla', 'plan'],
        },
      }),
    );
    expect(store.boardReads).toBe(1);
    expect(store.writes[0]?.fields).toEqual({
      assigneeUids: ['u3'],
      nameTokens: ['pl', 'pla', 'plan'],
    });
  });

  it('uses the subitem columns for a subitem', async () => {
    const store = new FakeStore();
    await syncItemIndexFields(
      store,
      change({
        after: {
          name: 'Sub',
          parentItemId: 'p1',
          values: { owner: people('u1'), sub_owner: people('u9') },
        },
      }),
    );
    expect(store.writes[0]?.fields).toMatchObject({ assigneeUids: ['u9'] });
  });

  it('writes nothing when the stored fields are already right (retry, own-write retrigger)', async () => {
    const store = new FakeStore();
    const synced = {
      name: 'Plan Q3',
      values: { owner: people('u1') },
      assigneeUids: ['u1'],
      nameTokens: ['pl', 'pla', 'plan', 'q3'],
    };
    // Created and already indexed (a retried event).
    expect(await syncItemIndexFields(store, change({ after: synced }))).toBe(false);
    // The retrigger of our own write: nothing changed apart from the index fields.
    expect(
      await syncItemIndexFields(
        store,
        change({
          before: { name: 'Plan Q3', values: synced.values },
          after: synced,
        }),
      ),
    ).toBe(false);
    expect(store.writes).toHaveLength(0);
    expect(store.boardReads).toBe(1); // only the create check needed the board
  });

  it('returns early, with no read, when neither name nor values changed and the fields exist', async () => {
    const store = new FakeStore();
    const values = { owner: people('u1') };
    const result = await syncItemIndexFields(
      store,
      change({
        before: { name: 'Plan', values },
        after: { name: 'Plan', values, assigneeUids: ['u1'], nameTokens: ['pl', 'pla', 'plan'] },
      }),
    );
    expect(result).toBe(false);
    expect(store.boardReads).toBe(0);
    expect(store.writes).toHaveLength(0);
  });

  it('heals an item whose fields are missing on any write', async () => {
    const store = new FakeStore();
    const values = { owner: people('u1') };
    await syncItemIndexFields(
      store,
      change({ before: { name: 'Plan', values }, after: { name: 'Plan', values } }),
    );
    expect(store.writes[0]?.fields).toEqual({
      assigneeUids: ['u1'],
      nameTokens: ['pl', 'pla', 'plan'],
    });
  });

  it('stores empty arrays so a finished item is not revisited', async () => {
    const store = new FakeStore();
    await syncItemIndexFields(store, change({ after: { name: 'x', values: {} } }));
    expect(store.writes[0]?.fields).toEqual({ assigneeUids: [], nameTokens: [] });
  });

  it('skips deleted items and boards that are gone', async () => {
    const store = new FakeStore();
    expect(
      await syncItemIndexFields(
        store,
        change({ after: { name: 'x', state: 'deleted', values: {} } }),
      ),
    ).toBe(false);
    store.board = null;
    expect(await syncItemIndexFields(store, change())).toBe(false);
    expect(store.writes).toHaveLength(0);
  });
});

describe('withSharedBoardRead', () => {
  it('lets the index sync and the assigned notifications share one board read', async () => {
    let reads = 0;
    const raw = {
      getBoard() {
        reads += 1;
        return Promise.resolve({
          name: 'Board',
          kind: 'main' as const,
          workspaceId: 'ws1',
          access: {},
          ...board,
        });
      },
      getWorkspaceRoles: () => Promise.resolve({}),
      getPrefs: () => Promise.resolve(undefined),
      getMemberProfile: () => Promise.resolve(null),
      getItemName: () => Promise.resolve('Plan'),
      getUpdateAuthorId: () => Promise.resolve(null),
      createNotification: () => Promise.resolve(true),
    } as unknown as NotificationStore;
    const shared = withSharedBoardRead(raw);
    const index = new FakeStore();
    const item = {
      name: 'Plan',
      values: { owner: people('u1') },
      updatedBy: 'u2',
      createdBy: 'u2',
    };
    await syncItemIndexFields(
      {
        getBoard: (id) => shared.getBoard(id),
        setItemIndex: (...args) => index.setItemIndex(...args),
      },
      { boardId: 'b1', itemId: 'i1', after: item },
    );
    await notifyPeopleAssigned(shared, { eventId: 'e1', boardId: 'b1', itemId: 'i1', after: item });
    expect(reads).toBe(1);
    expect(index.writes).toHaveLength(1);
  });
});
