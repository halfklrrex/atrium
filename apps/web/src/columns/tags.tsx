import type { TagsSettings, TagsValue } from '@atrium/shared';
import { Tags as TagsIcon } from '@vibe/icons';
import classNames from 'classnames';
import { useState, type KeyboardEvent } from 'react';
import { AnchoredPopup } from '../components/board-table/AnchoredPopup';
import styles from './cells.module.css';
import popups from './popups.module.css';
import { defineColumnUi, type CellProps, type EditorProps } from './types';

const VISIBLE_PILLS = 2;

function tagNameOf(settings: TagsSettings, id: number): string | undefined {
  return settings?.tags?.find((t) => t.id === id)?.name;
}

function TagsCell({ value, settings }: CellProps<TagsValue, TagsSettings>) {
  const ids = value?.tag_ids ?? [];
  const names = ids.flatMap((id) => {
    const name = tagNameOf(settings, id);
    return name === undefined ? [] : [name];
  });

  if (names.length === 0) {
    return (
      <div className={styles.root}>
        <span className={styles.hint}>
          <TagsIcon aria-hidden="true" />
        </span>
      </div>
    );
  }

  const shown = names.slice(0, VISIBLE_PILLS);
  const extra = names.length - shown.length;

  return (
    <div className={styles.root}>
      <span className={styles.pills}>
        {shown.map((name, i) => (
          <span key={i} className={styles.tagPill}>
            {name}
          </span>
        ))}
        {extra > 0 ? <span className={styles.more}>+{extra}</span> : null}
      </span>
    </div>
  );
}

function TagsEditor({
  value,
  settings,
  column,
  anchor,
  onChange,
  onClose,
  saveSettings,
}: EditorProps<TagsValue, TagsSettings>) {
  const [query, setQuery] = useState('');
  const selected = value?.tag_ids ?? [];
  const tags = settings?.tags ?? [];
  const needle = query.trim().toLowerCase();
  const matches = tags.filter((t) => t.name.toLowerCase().includes(needle));
  const exact = tags.find((t) => t.name.toLowerCase() === needle);

  const write = (tag_ids: number[]) => onChange(tag_ids.length > 0 ? { tag_ids } : null);

  const toggle = (id: number) => {
    if (selected.includes(id)) {
      write(selected.filter((x) => x !== id));
    } else {
      write([...selected, id]);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key !== 'Enter' || needle === '') return;
    event.preventDefault();
    if (exact) {
      toggle(exact.id);
    } else {
      const nextId = Math.max(-1, ...tags.map((t) => t.id)) + 1;
      const newTag = { id: nextId, name: query.trim() };
      saveSettings({ ...settings, tags: [...tags, newTag] });
      write([...selected, nextId]);
    }
    setQuery('');
  };

  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} label={column.title}>
      <div className={popups.body}>
        {selected.length > 0 ? (
          <div className={popups.selectedPills}>
            {selected.map((id) => (
              <button
                key={id}
                type="button"
                className={popups.selectedPill}
                aria-label={`Remove ${tagNameOf(settings, id) ?? 'tag'}`}
                onClick={() => write(selected.filter((x) => x !== id))}
              >
                {tagNameOf(settings, id) ?? id} ×
              </button>
            ))}
          </div>
        ) : null}
        <input
          className={popups.input}
          value={query}
          placeholder="Search or add a tag"
          aria-label="Search or add a tag"
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={popups.list} role="listbox" aria-label={column.title} aria-multiselectable>
          {matches.map((tag) => {
            const isSelected = selected.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={classNames(popups.listRow, isSelected && popups.listRowOn)}
                onClick={() => toggle(tag.id)}
              >
                <span className={styles.tagPill}>{tag.name}</span>
              </button>
            );
          })}
          {needle !== '' && !exact ? (
            <p className={popups.muted}>Press Enter to create &ldquo;{query.trim()}&rdquo;</p>
          ) : null}
          {matches.length === 0 && needle === '' ? (
            <p className={popups.muted}>Type a name and press Enter to add a tag</p>
          ) : null}
        </div>
      </div>
    </AnchoredPopup>
  );
}

export const tagsUi = defineColumnUi<TagsValue, TagsSettings>({
  type: 'tags',
  icon: TagsIcon,
  tone: 'indigo',
  editor: 'popover',
  Cell: TagsCell,
  Editor: TagsEditor,
});
