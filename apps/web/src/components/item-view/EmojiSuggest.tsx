import { EmojiSuggestionPluginKey } from '@tiptap/extension-emoji';
import { exitSuggestion } from '@tiptap/suggestion';
import type { Editor } from '@tiptap/react';
import { useSyncExternalStore } from 'react';
import { AnchoredPopup } from '../board-table/AnchoredPopup';
import type { EmojiSuggestController } from './emoji-data';
import styles from './slash-menu/SlashMenu.module.css';

/** The `:` list: emoji matching what is typed after the colon. Focus stays in the editor. */
export function EmojiSuggestMenu({
  controller,
  editor,
}: {
  controller: EmojiSuggestController;
  editor: Editor;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!state || !state.anchor || state.items.length === 0) return null;
  const { items, selected, select } = state;
  return (
    <AnchoredPopup
      anchor={state.anchor}
      label="Insert emoji"
      className={styles.layer}
      onClose={() => exitSuggestion(editor.view, EmojiSuggestionPluginKey)}
    >
      <div
        role="listbox"
        aria-label="Emoji"
        className={styles.list}
        onMouseDown={(event) => event.preventDefault()}
      >
        {items.map((item, index) => (
          <div
            key={item.name}
            role="option"
            aria-selected={index === selected}
            className={styles.option}
            data-selected={index === selected || undefined}
            onMouseMove={() => {
              if (index !== selected) controller.set({ ...state, selected: index });
            }}
            onClick={() => select(item)}
          >
            <span className={styles.icon} aria-hidden="true">
              {item.emoji}
            </span>
            <span className={styles.title}>{item.name}</span>
          </div>
        ))}
      </div>
    </AnchoredPopup>
  );
}
