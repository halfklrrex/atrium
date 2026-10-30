import { emojis as allEmojis, type EmojiItem } from '@tiptap/extension-emoji';
import type { SuggestController } from './slash-menu/slash-controller';

/**
 * The emoji the editor offers: the extension's own data (no second emoji library), without the
 * skin-tone and hair components, the regional-indicator letters, and any fallback image URLs, so a
 * font without an emoji shows its code instead of loading a picture from a CDN.
 *
 * Emoji that default to text presentation (heart, skull, shamrock, airplane, ...) come from the
 * extension without U+FE0F, so Windows draws them as monochrome text glyphs. `asEmojiPresentation`
 * adds it.
 */
export const EMOJIS: EmojiItem[] = allEmojis
  .filter(
    (item) =>
      item.emoji && item.group !== 'components' && !item.name.startsWith('regional_indicator_'),
  )
  .map((item) => {
    const copy = { ...item, emoji: asEmojiPresentation(item.emoji ?? '') };
    delete copy.fallbackImage;
    return copy;
  });

/** Appends the emoji variation selector (U+FE0F) to a lone code point that defaults to text. */
export function asEmojiPresentation(emoji: string): string {
  const isSingle = [...emoji].length === 1;
  return isSingle && /\p{Emoji}/u.test(emoji) && !/\p{Emoji_Presentation}/u.test(emoji)
    ? `${emoji}️`
    : emoji;
}

export interface EmojiCategory {
  id: string;
  label: string;
  /** The extension's `group` values that belong to the category. */
  groups: string[];
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  { id: 'smileys', label: 'Smileys', groups: [''] },
  { id: 'people', label: 'People', groups: ['people & body'] },
  { id: 'nature', label: 'Nature', groups: ['animals & nature'] },
  { id: 'food', label: 'Food', groups: ['food & drink'] },
  { id: 'activities', label: 'Activities', groups: ['activities'] },
  { id: 'travel', label: 'Travel', groups: ['travel & places'] },
  { id: 'objects', label: 'Objects', groups: ['objects'] },
  { id: 'symbols', label: 'Symbols', groups: ['symbols'] },
  { id: 'flags', label: 'Flags', groups: ['flags'] },
];

const byCategory = new Map<string, EmojiItem[]>();
for (const category of EMOJI_CATEGORIES) {
  byCategory.set(
    category.id,
    EMOJIS.filter((item) => category.groups.includes(item.group ?? '')),
  );
}

export const emojisInCategory = (id: string): EmojiItem[] => byCategory.get(id) ?? [];

const byName = new Map(EMOJIS.map((item) => [item.name, item]));
export const emojiByName = (name: string): EmojiItem | undefined => byName.get(name);

/** Emoji whose name, shortcode or tag contains the query; names that start with it come first. */
export function searchEmojis(query: string, limit = 200): EmojiItem[] {
  const q = query.trim().toLowerCase().replace(/^:/, '');
  if (!q) return [];
  const starts: EmojiItem[] = [];
  const contains: EmojiItem[] = [];
  for (const item of EMOJIS) {
    const names = [item.name, ...item.shortcodes];
    if (names.some((n) => n.startsWith(q))) starts.push(item);
    else if (names.some((n) => n.includes(q)) || item.tags.some((t) => t.startsWith(q))) {
      contains.push(item);
    }
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

// ---- Recently used (localStorage; every access guarded: it can throw or be blocked) ----

export const RECENT_EMOJI_KEY = 'atrium.recent-emoji';
export const RECENT_EMOJI_MAX = 16;

export function loadRecentEmoji(): EmojiItem[] {
  try {
    const raw = window.localStorage.getItem(RECENT_EMOJI_KEY);
    const names: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(names)) return [];
    return names
      .filter((n): n is string => typeof n === 'string')
      .map(emojiByName)
      .filter((item): item is EmojiItem => Boolean(item))
      .slice(0, RECENT_EMOJI_MAX);
  } catch {
    return [];
  }
}

export function rememberEmoji(name: string): void {
  try {
    const names = loadRecentEmoji()
      .map((item) => item.name)
      .filter((n) => n !== name);
    window.localStorage.setItem(
      RECENT_EMOJI_KEY,
      JSON.stringify([name, ...names].slice(0, RECENT_EMOJI_MAX)),
    );
  } catch {
    // Storage is unavailable: the recents just don't persist.
  }
}

// ---- The ":" suggestion list ----

export type EmojiSuggestController = SuggestController<EmojiItem>;

/** `:` plus at least this many characters opens the suggestion list. */
export const EMOJI_SUGGEST_MIN_QUERY = 2;
const EMOJI_SUGGEST_LIMIT = 8;

export function emojiSuggestItems(query: string): EmojiItem[] {
  if (query.trim().length < EMOJI_SUGGEST_MIN_QUERY) return [];
  return searchEmojis(query, EMOJI_SUGGEST_LIMIT);
}
