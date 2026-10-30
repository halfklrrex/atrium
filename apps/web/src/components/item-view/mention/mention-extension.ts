import Mention from '@tiptap/extension-mention';
import type { Attribute } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import type { MentionController } from './mention-controller';

export const mentionPluginKey = new PluginKey('atriumMention');

/** The "@" chip: `{ type: 'mention', attrs: { id: <uid>, label: <name at insert time> } }`. */
export const AtriumMention = Mention.extend({
  addAttributes() {
    const { id, label } = (this.parent?.() ?? {}) as { id: Attribute; label: Attribute };
    // Only the uid and the label are stored (the parent adds a trigger-char attribute).
    return { id, label };
  },

  // Foreign HTML never becomes a mention: only our own span, and only with a non-empty data-id.
  parseHTML() {
    return [
      {
        tag: 'span[data-type="mention"][data-id]',
        getAttrs: (node) =>
          node instanceof HTMLElement && node.getAttribute('data-id') ? {} : false,
      },
    ];
  },
});

/**
 * Typing `@` (at the start or after a space) opens the member list. The list is a React component
 * fed through `controller`; without a controller (a read-only editor) no list ever opens.
 */
export function createMentionExtension(controller: MentionController | null) {
  return AtriumMention.configure({
    suggestion: {
      char: '@',
      pluginKey: mentionPluginKey,
      // The list works the members out itself; the plugin only needs to stay open.
      items: () => [],
      allow: ({ state, range, editor }) => {
        if (!controller || !editor.isEditable) return false;
        const $from = state.doc.resolve(range.from);
        const type = state.schema.nodes.mention;
        return !!type && !!$from.parent.type.contentMatch.matchType(type);
      },
      render: () => {
        const push = (props: {
          query: string;
          decorationNode: Element | null;
          command: (attrs: { id: string; label: string }) => void;
        }) => {
          controller?.set({
            query: props.query,
            anchor: props.decorationNode as HTMLElement | null,
            command: props.command,
          });
        };
        return {
          onStart: push,
          onUpdate: push,
          onExit: () => controller?.clear(),
          onKeyDown: ({ event }) => controller?.keys?.(event) ?? false,
        };
      },
    },
  });
}
