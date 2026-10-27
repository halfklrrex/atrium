import { describe, expect, it } from 'vitest';
import {
  allocateItemNumbers,
  type BoardItemCounters,
  type ItemNumberState,
  type ItemSeqTx,
} from './item-seq';

/** In-memory store over persistent data; enforces reads-before-writes like Firestore. */
class FakeTx implements ItemSeqTx {
  items = new Map<string, ItemNumberState>();
  global = 0;
  boards = new Map<string, BoardItemCounters>();
  writes = 0;
  private wrote = false;

  begin(): this {
    this.wrote = false;
    return this;
  }
  private read() {
    if (this.wrote) throw new Error('Read after write inside transaction');
  }
  private write() {
    this.wrote = true;
    this.writes += 1;
  }
  getItem(boardId: string, itemId: string) {
    this.read();
    return Promise.resolve(this.items.get(`${boardId}/${itemId}`) ?? null);
  }
  getGlobalCounter() {
    this.read();
    return Promise.resolve(this.global);
  }
  getBoardCounters(boardId: string) {
    this.read();
    return Promise.resolve({ ...(this.boards.get(boardId) ?? { nextItem: 0, nextSubitem: 0 }) });
  }
  setItemNumbers(boardId: string, itemId: string, numbers: { seq?: number; boardSeq?: number }) {
    this.write();
    const key = `${boardId}/${itemId}`;
    this.items.set(key, { ...(this.items.get(key) as ItemNumberState), ...numbers });
  }
  setGlobalCounter(next: number) {
    this.write();
    this.global = next;
  }
  setBoardCounters(boardId: string, counters: BoardItemCounters) {
    this.write();
    this.boards.set(boardId, { ...counters });
  }
}

const add = (tx: FakeTx, board: string, id: string, isSubitem = false, extra = {}) =>
  tx.items.set(`${board}/${id}`, { isSubitem, ...extra });

describe('allocateItemNumbers', () => {
  it('numbers items 1, 2, 3 account-wide and per board', async () => {
    const tx = new FakeTx();
    add(tx, 'b1', 'a');
    add(tx, 'b2', 'b');
    add(tx, 'b1', 'c');
    expect(await allocateItemNumbers(tx.begin(), 'b1', 'a')).toEqual({ seq: 1, boardSeq: 1 });
    expect(await allocateItemNumbers(tx.begin(), 'b2', 'b')).toEqual({ seq: 2, boardSeq: 1 });
    expect(await allocateItemNumbers(tx.begin(), 'b1', 'c')).toEqual({ seq: 3, boardSeq: 2 });
    expect(tx.global).toBe(3);
    expect(tx.boards.get('b1')).toEqual({ nextItem: 2, nextSubitem: 0 });
  });

  it('keeps a separate sequence for subitems', async () => {
    const tx = new FakeTx();
    add(tx, 'b1', 'p');
    add(tx, 'b1', 's1', true);
    add(tx, 'b1', 's2', true);
    await allocateItemNumbers(tx.begin(), 'b1', 'p');
    expect(await allocateItemNumbers(tx.begin(), 'b1', 's1')).toEqual({ seq: 2, boardSeq: 1 });
    expect(await allocateItemNumbers(tx.begin(), 'b1', 's2')).toEqual({ seq: 3, boardSeq: 2 });
    expect(tx.boards.get('b1')).toEqual({ nextItem: 1, nextSubitem: 2 });
  });

  it('continues from existing counters', async () => {
    const tx = new FakeTx();
    tx.global = 40;
    tx.boards.set('b1', { nextItem: 7, nextSubitem: 3 });
    add(tx, 'b1', 'a');
    expect(await allocateItemNumbers(tx.begin(), 'b1', 'a')).toEqual({ seq: 41, boardSeq: 8 });
  });

  it('is idempotent: a retried or replayed event assigns nothing new', async () => {
    const tx = new FakeTx();
    add(tx, 'b1', 'a');
    await allocateItemNumbers(tx.begin(), 'b1', 'a');
    const writes = tx.writes;
    expect(await allocateItemNumbers(tx.begin(), 'b1', 'a')).toBeNull();
    expect(tx.writes).toBe(writes);
    expect(tx.global).toBe(1);
  });

  it('skips an item that was deleted before the trigger ran', async () => {
    const tx = new FakeTx();
    expect(await allocateItemNumbers(tx.begin(), 'b1', 'gone')).toBeNull();
    expect(tx.writes).toBe(0);
  });

  it('fills only the missing number of a partly numbered item', async () => {
    const tx = new FakeTx();
    tx.global = 9;
    add(tx, 'b1', 'a', false, { seq: 5 });
    expect(await allocateItemNumbers(tx.begin(), 'b1', 'a')).toEqual({ seq: 5, boardSeq: 1 });
    expect(tx.global).toBe(9);
    expect(tx.items.get('b1/a')).toEqual({ isSubitem: false, seq: 5, boardSeq: 1 });
  });
});
