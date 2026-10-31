import { nameTokensOf, searchWordsOf } from '@atrium/shared';
import type { BoardDoc, ItemDoc, WorkspaceDoc } from '../../data/model';

/** At most this many results are shown across all groups. */
export const MAX_RESULTS = 50;
/** Items are searched from this many typed characters. */
export const MIN_ITEM_CHARS = 2;

export type SearchTab = 'all' | 'boards' | 'items';

export type SearchResult =
  | { kind: 'workspace'; id: string; workspace: WorkspaceDoc }
  | { kind: 'board'; id: string; board: BoardDoc; workspaceName: string }
  | { kind: 'item'; id: string; item: ItemDoc; board: BoardDoc; groupTitle: string };

/** Lowercase, accents removed: the same folding the item tokens use. */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/** The words of a term as typed, folded, longest first (the order the item query uses). */
export function termWords(term: string): string[] {
  return searchWordsOf(term);
}

/** The folded words of `text` (letters and digits only). */
function wordsIn(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/**
 * True when every typed word is the start of some word of the name. Words of two or more
 * characters are looked up in the name's tokens; a single character is checked on the name itself.
 */
export function nameMatchesWords(name: string, words: readonly string[]): boolean {
  if (words.length === 0) return false;
  const tokens = new Set(nameTokensOf(name));
  const nameWords = wordsIn(name);
  return words.every((word) =>
    [...word].length >= MIN_ITEM_CHARS
      ? tokens.has(word) || nameWords.some((w) => w.startsWith(word))
      : nameWords.some((w) => w.startsWith(word)),
  );
}

/** Rank: a name that starts with the term first, then the other matches, each in given order. */
export function rankByPrefix<T>(rows: readonly T[], nameOf: (row: T) => string, term: string): T[] {
  const needle = fold(term.trim());
  const scored = rows.map((row, index) => ({
    row,
    index,
    starts: fold(nameOf(row)).startsWith(needle) ? 0 : 1,
  }));
  scored.sort((a, b) => a.starts - b.starts || a.index - b.index);
  return scored.map((s) => s.row);
}

/** Case- and accent-insensitive substring filter used for workspaces and boards. */
export function filterByName<T>(rows: readonly T[], nameOf: (row: T) => string, term: string): T[] {
  const needle = fold(term.trim());
  if (!needle) return [];
  return rankByPrefix(
    rows.filter((row) => fold(nameOf(row)).includes(needle)),
    nameOf,
    term,
  );
}

export interface SearchGroups {
  workspaces: Extract<SearchResult, { kind: 'workspace' }>[];
  boards: Extract<SearchResult, { kind: 'board' }>[];
  items: Extract<SearchResult, { kind: 'item' }>[];
}

/** Which groups a tab shows. */
export function groupsForTab(groups: SearchGroups, tab: SearchTab): SearchGroups {
  return {
    workspaces: tab === 'all' ? groups.workspaces : [],
    boards: tab === 'items' ? [] : groups.boards,
    items: tab === 'boards' ? [] : groups.items,
  };
}

/** Cap the total at `MAX_RESULTS`, keeping group order (workspaces, boards, items). */
export function capGroups(groups: SearchGroups, max: number = MAX_RESULTS): SearchGroups {
  let left = max;
  const take = <T>(rows: T[]): T[] => {
    const out = rows.slice(0, left);
    left -= out.length;
    return out;
  };
  const workspaces = take(groups.workspaces);
  const boards = take(groups.boards);
  const items = take(groups.items);
  return { workspaces, boards, items };
}

/** The flat keyboard order of the visible groups. */
export function flattenGroups(groups: SearchGroups): SearchResult[] {
  return [...groups.workspaces, ...groups.boards, ...groups.items];
}

/** The router path a result opens. */
export function resultPath(result: SearchResult): string {
  switch (result.kind) {
    case 'workspace':
      return `/workspaces/${result.workspace.id}`;
    case 'board':
      return `/boards/${result.board.id}`;
    case 'item':
      return `/boards/${result.board.id}/items/${result.item.id}`;
  }
}

/** Move the active index by `delta` through `count` rows, wrapping around. */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

export interface TextPart {
  text: string;
  match: boolean;
}

/** Split `text` so that every occurrence of any typed word start is marked (accent-insensitive). */
export function highlightParts(text: string, term: string): TextPart[] {
  const words = [...new Set(fold(term).split(/\s+/).filter(Boolean))];
  if (words.length === 0 || !text) return [{ text, match: false }];
  // Folding can change the length of a character, so match on a per-character folded copy.
  const chars = [...text];
  const folded = chars.map((c) => fold(c));
  const marked = new Array<boolean>(chars.length).fill(false);
  const joined = folded.join('');
  const offsets: number[] = [];
  let at = 0;
  for (const piece of folded) {
    offsets.push(at);
    at += piece.length;
  }
  const charAt = (offset: number) => {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (offsets[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (const word of words) {
    let from = 0;
    for (;;) {
      const found = joined.indexOf(word, from);
      if (found === -1) break;
      const first = charAt(found);
      const last = charAt(found + word.length - 1);
      for (let i = first; i <= last; i += 1) marked[i] = true;
      from = found + word.length;
    }
  }
  const parts: TextPart[] = [];
  chars.forEach((char, i) => {
    const match = marked[i]!;
    const last = parts[parts.length - 1];
    if (last && last.match === match) last.text += char;
    else parts.push({ text: char, match });
  });
  return parts;
}
