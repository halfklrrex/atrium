import { useSyncExternalStore } from 'react';
import { exitSuggestion } from '@tiptap/suggestion';
import type { Editor } from '@tiptap/react';
import { AnchoredPopup } from '../../board-table/AnchoredPopup';
import type { SlashController } from './slash-controller';
import styles from './SlashMenu.module.css';

/** The "/" menu: a listbox of blocks hanging from the caret. Focus stays in the editor. */
export function SlashMenu({ controller, editor }: { controller: SlashController; editor: Editor }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!state || !state.anchor || state.items.length === 0) return null;
  const { items, selected, select } = state;
  return (
    <AnchoredPopup
      anchor={state.anchor}
      label="Insert block"
      className={styles.layer}
      onClose={() => exitSuggestion(editor.view)}
    >
      <div
        role="listbox"
        aria-label="Blocks"
        className={styles.list}
        onMouseDown={(event) => event.preventDefault()}
      >
        {items.map((item, index) => (
          <div
            key={item.id}
            role="option"
            aria-selected={index === selected}
            className={styles.option}
            data-selected={index === selected || undefined}
            ref={(node) => {
              if (node && index === selected) node.scrollIntoView?.({ block: 'nearest' });
            }}
            onMouseMove={() => {
              if (index !== selected) controller.set({ ...state, selected: index });
            }}
            onClick={() => select(item)}
          >
            <span className={styles.icon}>
              <item.Icon aria-hidden />
            </span>
            <span className={styles.title}>{item.title}</span>
            <span className={styles.hint}>{item.hint}</span>
          </div>
        ))}
      </div>
    </AnchoredPopup>
  );
}
