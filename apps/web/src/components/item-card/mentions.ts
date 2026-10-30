import { NOTIFICATION_LIMITS } from '@atrium/shared';

/** A member picked from the @ list: the uid sent as a mention, the name written into the text. */
export interface PickedMention {
  uid: string;
  name: string;
}

/** The longest "@query" that still counts as someone typing a name. */
const MAX_QUERY_LENGTH = 30;

export interface MentionQuery {
  /** Index of the "@" in the text. */
  start: number;
  /** What was typed after it, up to the caret. */
  query: string;
}

/**
 * The "@query" the caret is in, or null. The @ must start a word (so an email address does not
 * count), and the query may hold spaces (names do) but not a line break.
 */
export function activeMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(before[start - 1] ?? '')) return null;
  const query = before.slice(start + 1);
  if (query.length > MAX_QUERY_LENGTH || query.includes('\n')) return null;
  return { start, query };
}

/** Swaps the "@query" for "@Name " and says where the caret goes. */
export function applyMention(
  text: string,
  mention: MentionQuery,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `;
  return {
    text: text.slice(0, mention.start) + inserted + text.slice(caret),
    caret: mention.start + inserted.length,
  };
}

/**
 * The uids to send with a post: the picked members whose "@Name" is still in the text (picking and
 * then deleting the name must not notify anyone), without duplicates and within the limit.
 */
export function mentionIdsInText(text: string, picked: readonly PickedMention[]): string[] {
  const ids: string[] = [];
  for (const { uid, name } of picked) {
    if (ids.includes(uid)) continue;
    if (text.includes(`@${name}`)) ids.push(uid);
  }
  return ids.slice(0, NOTIFICATION_LIMITS.mentions);
}

export interface MentionPart {
  text: string;
  mention: boolean;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Splits `text` so every "@Name" of the given names is its own part. */
export function splitMentions(text: string, names: readonly string[]): MentionPart[] {
  const unique = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (unique.length === 0) return [{ text, mention: false }];
  const pattern = new RegExp(`@(?:${unique.map(escapeRegExp).join('|')})`, 'g');
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    if (at > last) parts.push({ text: text.slice(last, at), mention: false });
    parts.push({ text: match[0], mention: true });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false });
  return parts;
}
