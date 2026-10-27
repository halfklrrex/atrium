import { Extension, type Editor } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SlashController } from './slash-controller';
import { filterSlashItems, type SlashItem } from './slash-items';

const slashKey = new PluginKey('atriumSlashMenu');

/**
 * The "/" block menu. `/` at the start of a paragraph or after a space opens it; the plugin owns
 * the query, Escape and the decoration, the `controller` feeds the React menu. Not offered inside
 * code blocks.
 */
export function createSlashCommand(controller: SlashController) {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          pluginKey: slashKey,
          char: '/',
          allowSpaces: true,
          decorationClass: 'slash-suggestion',
          items: ({ query }) => filterSlashItems(query),
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from);
            return !$from.parent.type.spec.code;
          },
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => {
            const push = (props: {
              editor: Editor;
              items: SlashItem[];
              command: (item: SlashItem) => void;
              decorationNode: Element | null;
            }) => {
              controller.set({
                items: props.items,
                anchor: props.decorationNode as HTMLElement | null,
                select: props.command,
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
        }),
      ];
    },
  });
}
