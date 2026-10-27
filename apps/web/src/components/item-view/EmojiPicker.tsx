import type { EmojiItem } from '@tiptap/extension-emoji';
import type { Editor } from '@tiptap/react';
import { TextField, Tooltip } from '@vibe/core';
import { useMemo, useState } from 'react';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import {
  EMOJI_CATEGORIES,
  emojisInCategory,
  loadRecentEmoji,
  rememberEmoji,
  searchEmojis,
} from './emoji-data';
import styles from './DescriptionEditor.module.css';

function EmojiGrid({
  items,
  label,
  onPick,
}: {
  items: EmojiItem[];
  label: string;
  onPick: (item: EmojiItem) => void;
}) {
  return (
    <div className={styles.emojiGrid} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.name}
          type="button"
          className={styles.emojiButton}
          aria-label={item.name.replace(/_/g, ' ')}
          title={item.name.replace(/_/g, ' ')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(item)}
        >
          {item.emoji}
        </button>
      ))}
    </div>
  );
}

/**
 * The emoji picker: a search box, category tabs, an 8-column grid and "Recently used" (up to 16,
 * kept in localStorage). It inserts Unicode emoji through the editor's `setEmoji`.
 */
export function EmojiPicker({
  anchor,
  editor,
  onClose,
}: {
  anchor: HTMLElement | null;
  editor: Editor;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState(EMOJI_CATEGORIES[0]!.id);
  // Read once per opening: the list should not reshuffle while the picker is open.
  const recent = useMemo(() => loadRecentEmoji(), []);
  const searching = query.trim().length > 0;
  const results = useMemo(() => (searching ? searchEmojis(query) : []), [query, searching]);
  const category = EMOJI_CATEGORIES.find((c) => c.id === categoryId) ?? EMOJI_CATEGORIES[0]!;

  const pick = (item: EmojiItem) => {
    rememberEmoji(item.name);
    editor.chain().focus().setEmoji(item.name).run();
    onClose();
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label="Emoji">
      <div
        className={styles.emojiPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && searching && results[0]) {
            event.preventDefault();
            pick(results[0]);
          }
        }}
      >
        <TextField
          title="Search emoji"
          placeholder="Search emoji"
          value={query}
          autoFocus
          size="small"
          onChange={(value: string) => setQuery(value)}
        />
        {searching ? null : (
          <div className={styles.emojiTabs} role="tablist" aria-label="Emoji categories">
            {EMOJI_CATEGORIES.map((c) => (
              <Tooltip key={c.id} content={c.label}>
                <button
                  type="button"
                  role="tab"
                  className={styles.emojiTab}
                  aria-label={c.label}
                  aria-selected={c.id === category.id}
                  onClick={() => setCategoryId(c.id)}
                >
                  {emojisInCategory(c.id)[0]?.emoji}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        <div className={styles.emojiScroll}>
          {searching ? (
            results.length > 0 ? (
              <EmojiGrid items={results} label="Search results" onPick={pick} />
            ) : (
              <p className={styles.emojiEmpty}>No emoji found</p>
            )
          ) : (
            <>
              {recent.length > 0 ? (
                <>
                  <h4 className={styles.emojiHeading}>Recently used</h4>
                  <EmojiGrid items={recent} label="Recently used" onPick={pick} />
                </>
              ) : null}
              <h4 className={styles.emojiHeading}>{category.label}</h4>
              <EmojiGrid
                items={emojisInCategory(category.id)}
                label={category.label}
                onPick={pick}
              />
            </>
          )}
        </div>
      </div>
    </AnchoredPopup>
  );
}
