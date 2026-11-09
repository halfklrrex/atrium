import { TextField } from '@vibe/core';
import { useMemo, useState } from 'react';
import {
  EMOJI_CATEGORIES,
  emojisInCategory,
  loadRecentEmoji,
  rememberEmoji,
  searchEmojis,
} from '../item-view/emoji-data';
import { handleGridKeys } from './grid-keys';
import styles from './IconPicker.module.css';

/** Search and pick an emoji for a workspace. Loaded on demand: the emoji data is large. */
export default function EmojiTab({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (emoji: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState(EMOJI_CATEGORIES[0]!.id);
  const recent = useMemo(() => loadRecentEmoji(), []);
  const searching = query.trim().length > 0;
  const items = searching
    ? searchEmojis(query)
    : [...(recent.length ? recent : []), ...emojisInCategory(categoryId)];

  return (
    <div className={styles.picker}>
      <TextField
        inputAriaLabel="Search emoji"
        placeholder="Search emoji"
        value={query}
        size="small"
        onChange={(v: string) => setQuery(v)}
      />
      {searching ? null : (
        <div className={styles.categories} role="group" aria-label="Emoji categories">
          {EMOJI_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={styles.category}
              aria-label={c.label}
              title={c.label}
              aria-pressed={c.id === categoryId}
              onClick={() => setCategoryId(c.id)}
            >
              {emojisInCategory(c.id)[0]?.emoji ?? ''}
            </button>
          ))}
        </div>
      )}
      <div className={styles.scroll} onKeyDown={handleGridKeys}>
        {items.length ? (
          <div className={styles.grid} role="group" aria-label="Emoji">
            {items.map((item, i) => (
              <button
                key={`${item.name}-${i}`}
                type="button"
                data-grid-cell=""
                className={styles.cell}
                aria-label={item.name.replace(/_/g, ' ')}
                title={item.name.replace(/_/g, ' ')}
                aria-pressed={item.emoji === value}
                tabIndex={i === 0 ? 0 : -1}
                onFocus={(e) => {
                  for (const b of e.currentTarget.parentElement?.children ?? []) {
                    (b as HTMLElement).tabIndex = b === e.currentTarget ? 0 : -1;
                  }
                }}
                onClick={() => {
                  rememberEmoji(item.name);
                  onPick(item.emoji ?? '');
                }}
              >
                {item.emoji ?? ''}
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>No emoji found</p>
        )}
      </div>
    </div>
  );
}
