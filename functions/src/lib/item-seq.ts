/**
 * Server-assigned item numbers (P2 numeric item IDs). Every new item gets:
 *
 * - `seq`: an account-wide number (1, 2, 3, ...; never reused), shown by the Item ID column;
 * - `boardSeq`: the item's creation number on its board, with a separate sequence for subitems,
 *   shown by the Auto number column.
 *
 * The counters live in Functions-only documents (`counters/items` and
 * `boards/{id}/counters/items`; Firestore rules refuse clients). Despite the field names, `next`,
 * `nextItem` and `nextSubitem` hold the *last number handed out*, so an absent counter reads as 0
 * and the first number is 1. The pure allocation below takes an injected transaction so it can be
 * unit-tested; the `onItemCreated` trigger and the backfill script use the same counters.
 */

/** Counter state of one board: the last number handed out for items and for subitems. */
export interface BoardItemCounters {
  nextItem: number;
  nextSubitem: number;
}

/** The slice of an item document the allocation needs. */
export interface ItemNumberState {
  /** True for a subitem (`parentItemId` is set). */
  isSubitem: boolean;
  seq?: number;
  boardSeq?: number;
}

/** Narrow transaction interface. All reads must happen before any write (Firestore rule). */
export interface ItemSeqTx {
  /** `null` when the item no longer exists. */
  getItem(boardId: string, itemId: string): Promise<ItemNumberState | null>;
  /** Last global number handed out (0 when the counter document does not exist). */
  getGlobalCounter(): Promise<number>;
  /** Board counters (both 0 when the counter document does not exist). */
  getBoardCounters(boardId: string): Promise<BoardItemCounters>;
  setItemNumbers(
    boardId: string,
    itemId: string,
    numbers: { seq?: number; boardSeq?: number },
  ): void;
  setGlobalCounter(next: number): void;
  setBoardCounters(boardId: string, counters: BoardItemCounters): void;
}

export interface ItemNumbers {
  seq: number;
  boardSeq: number;
}

/**
 * Hands out the missing numbers of one item, in the caller's transaction. Idempotent: returns
 * `null` without writing when the item is gone or already has both numbers, so a retried trigger
 * never advances a counter twice. Does not touch `updatedAt` or `updatedBy` (not an edit).
 */
export async function allocateItemNumbers(
  tx: ItemSeqTx,
  boardId: string,
  itemId: string,
): Promise<ItemNumbers | null> {
  const item = await tx.getItem(boardId, itemId);
  if (!item) return null;
  const needSeq = typeof item.seq !== 'number';
  const needBoardSeq = typeof item.boardSeq !== 'number';
  if (!needSeq && !needBoardSeq) return null;

  const global = await tx.getGlobalCounter();
  const board = await tx.getBoardCounters(boardId);

  const seq = needSeq ? global + 1 : (item.seq as number);
  const counters = { ...board };
  let boardSeq = item.boardSeq as number;
  if (needBoardSeq) {
    if (item.isSubitem) {
      boardSeq = board.nextSubitem + 1;
      counters.nextSubitem = boardSeq;
    } else {
      boardSeq = board.nextItem + 1;
      counters.nextItem = boardSeq;
    }
  }

  tx.setItemNumbers(boardId, itemId, {
    ...(needSeq ? { seq } : {}),
    ...(needBoardSeq ? { boardSeq } : {}),
  });
  if (needSeq) tx.setGlobalCounter(seq);
  if (needBoardSeq) tx.setBoardCounters(boardId, counters);
  return { seq, boardSeq };
}
