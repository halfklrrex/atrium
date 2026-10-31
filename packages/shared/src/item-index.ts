import { peopleValueSchema } from './columns/people';

/**
 * Server-maintained search/assignment index fields of an item (P3 My Work and global search).
 *
 * - `assigneeUids`: sorted unique uids of the `person` entries across the board's People columns
 *   (`subitemColumns` for subitems). Firestore cannot query "assigned to me" from the nested
 *   `values.<colId>.personsAndTeams[]` maps, so Cloud Functions keep this flat array in sync.
 * - `nameTokens`: lowercase, diacritics-stripped prefixes (2 to 15 characters) of every word of the
 *   item name, for `array-contains` name search.
 *
 * Only Cloud Functions write them (they are in neither item key list of the rules). Both are an
 * index hint: the web recomputes `assigneeUids` from the item's values before showing a row.
 */
export const ITEM_INDEX_LIMITS = { maxTokens: 100, minPrefix: 2, maxPrefix: 15 } as const;

export interface IndexColumn {
  id: string;
  type: string;
}

export interface ItemIndexBoard {
  columns: ReadonlyArray<IndexColumn>;
  subitemColumns?: ReadonlyArray<IndexColumn>;
}

export interface ItemIndexSource {
  name?: unknown;
  values?: Record<string, unknown> | null;
  parentItemId?: string | null;
}

export interface ItemIndexFields {
  assigneeUids: string[];
  nameTokens: string[];
}

/** Uids of the `person` entries in the People columns of `columns`; sorted, unique. */
export function assigneeUidsOf(
  columns: ReadonlyArray<IndexColumn>,
  values: Record<string, unknown> | null | undefined,
): string[] {
  const found = new Set<string>();
  for (const column of columns) {
    if (column.type !== 'people') continue;
    const parsed = peopleValueSchema.safeParse(values?.[column.id]);
    if (!parsed.success) continue;
    for (const entry of parsed.data.personsAndTeams) {
      if (entry.kind === 'person') found.add(entry.id);
    }
  }
  return [...found].sort();
}

/** Lowercase, NFKD, combining marks removed, split on anything that is not a letter or digit. */
function wordsOf(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** Every prefix of each word from 2 to 15 characters, unique, at most 100, in name order. */
export function nameTokensOf(name: unknown): string[] {
  if (typeof name !== 'string') return [];
  const { maxTokens, minPrefix, maxPrefix } = ITEM_INDEX_LIMITS;
  const tokens = new Set<string>();
  for (const word of wordsOf(name)) {
    const chars = [...word];
    const longest = Math.min(chars.length, maxPrefix);
    for (let length = minPrefix; length <= longest; length += 1) {
      tokens.add(chars.slice(0, length).join(''));
      if (tokens.size >= maxTokens) return [...tokens];
    }
  }
  return [...tokens];
}

/**
 * The words of a search term, normalised like the tokens, each cut to 15 characters, longest
 * first (ties keep their order). The caller queries `nameTokens array-contains <first word>`; a
 * word shorter than 2 characters has no token.
 */
export function searchWordsOf(term: string): string[] {
  const { maxPrefix } = ITEM_INDEX_LIMITS;
  const words = wordsOf(term).map((word) => [...word].slice(0, maxPrefix).join(''));
  return words
    .map((word, index) => ({ word, index }))
    .sort((a, b) => [...b.word].length - [...a.word].length || a.index - b.index)
    .map(({ word }) => word);
}

/** Both index fields of an item; a subitem (`parentItemId` set) uses the board's subitem columns. */
export function itemIndexFields(board: ItemIndexBoard, item: ItemIndexSource): ItemIndexFields {
  const columns = item.parentItemId != null ? (board.subitemColumns ?? []) : board.columns;
  return {
    assigneeUids: assigneeUidsOf(columns, item.values),
    nameTokens: nameTokensOf(item.name),
  };
}
