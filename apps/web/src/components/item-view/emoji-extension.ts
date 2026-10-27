import { Emoji, type EmojiItem } from '@tiptap/extension-emoji';
import type { Editor } from '@tiptap/react';
import {
  EMOJIS,
  emojiSuggestItems,
  rememberEmoji,
  type EmojiSuggestController,
} from './emoji-data';

/**
 * Emoji as Unicode (the extension renders the character as text, with no image fallback):
 * `:shortcode:` input rules, plus a `:` suggestion list that opens after two characters.
 */
export function createEmojiExtension(controller: EmojiSuggestController) {
  return Emoji.configure({
    emojis: EMOJIS,
    enableEmoticons: false,
    forceFallbackImages: false,
    suggestion: {
      items: ({ query }) => emojiSuggestItems(query),
      render: () => {
        const push = (props: {
          editor: Editor;
          items: EmojiItem[];
          command: (item: EmojiItem) => void;
          decorationNode: Element | null;
        }) => {
          controller.set({
            items: props.items,
            anchor: props.decorationNode as HTMLElement | null,
            select: (item) => {
              rememberEmoji(item.name);
              props.command(item);
            },
          });
        };
        return {
          onStart: push,
          onUpdate: push,
          onExit: () => controller.clear(),
          onKeyDown: ({ event }) => {
            if (event.key === 'ArrowDown') {
              controller.move(1);
              return true;
            }
            if (event.key === 'ArrowUp') {
              controller.move(-1);
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              return controller.chooseSelected();
            }
            return false;
          },
        };
      },
    },
  });
}
