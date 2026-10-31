import { getDocs } from 'firebase/firestore';
import { MIN_ITEM_CHARS, nameMatchesWords, termWords } from '../components/search/search-model';
import { queries } from './firestore';
import type { BoardDoc, ItemDoc } from './model';

/** At most this many board queries run at once. */
export const SEARCH_CONCURRENCY = 10;
/** Each board answers with at most this many items. */
export const SEARCH_ITEMS_PER_BOARD = 10;

export interface ItemSearchOutcome {
  /** Boards that were queried. */
  total: number;
  /** Boards whose query failed (for example access lost); results of the others are kept. */
  failed: number;
}

/**
 * Searches item names across `boards`: one `nameTokens array-contains <longest word>` query per
 * board (read rules authorise each one, so a board the user cannot read is never listed), then
 * every typed word must match the name. Results stream in per board through `onBoard`. A newer
 * term aborts the older run through `signal`; nothing is delivered after an abort.
 */
export async function searchItems(
  boards: readonly BoardDoc[],
  term: string,
  signal: AbortSignal,
  onBoard: (board: BoardDoc, items: ItemDoc[]) => void,
  concurrency: number = SEARCH_CONCURRENCY,
): Promise<ItemSearchOutcome> {
  const words = termWords(term);
  const first = words[0];
  const outcome: ItemSearchOutcome = { total: boards.length, failed: 0 };
  if (!first || [...first].length < MIN_ITEM_CHARS) return outcome;

  let next = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const board = boards[next++];
      if (!board) return;
      try {
        const snap = await getDocs(
          queries.itemsByNameToken(board.id, first, SEARCH_ITEMS_PER_BOARD),
        );
        if (signal.aborted) return;
        const items = snap.docs.map((d) => d.data()).filter((i) => nameMatchesWords(i.name, words));
        if (items.length > 0) onBoard(board, items);
      } catch {
        if (signal.aborted) return;
        outcome.failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  return outcome;
}
